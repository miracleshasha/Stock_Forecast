"""시세 외 부가 데이터: 업종, 투자자별 매매동향 (홈 화면용).

- 업종: 미국은 S&P500 목록(datahub)의 GICS Sector 를 한글로, 국내는 KIS 현재가의 업종명.
  종목 구성이 거의 안 바뀌므로 토요일 전량 배치에서 비어 있는 종목만 채웁니다.
- 투자자별 매매동향: 국내 종목만(KIS). 국내 배치 끝에 최근 30거래일을 다시 받아 덮어씁니다.

사용법: python extras.py            (업종 빈 곳 채우기 + 투자자 동향 수집)
        python extras.py --sectors  (업종만, 전 종목 다시)
        python extras.py --flows    (투자자 동향만)
"""
from __future__ import annotations

import csv
import io
import sys
import traceback

import requests

import kis_client
import supabase_io
import universe

GICS_KO = {
    "Information Technology": "정보기술",
    "Health Care": "헬스케어",
    "Financials": "금융",
    "Consumer Discretionary": "경기소비재",
    "Communication Services": "커뮤니케이션",
    "Industrials": "산업재",
    "Consumer Staples": "필수소비재",
    "Energy": "에너지",
    "Utilities": "유틸리티",
    "Real Estate": "부동산",
    "Materials": "소재",
}

# S&P500 목록 밖 종목(성장주·해외 상장 ADR, 목록에서 빠진 종목)은 GICS 기준으로 직접 분류.
# 유니버스에 종목을 추가하면 여기도 채워 주세요(없으면 '기타'로 묶임).
US_SECTOR_OVERRIDES = {
    "AFRM": "금융", "SOFI": "금융", "UPST": "금융", "NU": "금융",
    "ARM": "정보기술", "ASML": "정보기술", "TSM": "정보기술", "AI": "정보기술", "IONQ": "정보기술",
    "QBTS": "정보기술", "RGTI": "정보기술", "SOUN": "정보기술", "MSTR": "정보기술",
    "MARA": "정보기술", "RIOT": "정보기술", "TTD": "정보기술",
    "ASTS": "커뮤니케이션", "ROKU": "커뮤니케이션", "SNAP": "커뮤니케이션",
    "DKNG": "경기소비재", "JD": "경기소비재", "PDD": "경기소비재", "BABA": "경기소비재", "CPNG": "경기소비재",
    "SE": "경기소비재", "LCID": "경기소비재", "RIVN": "경기소비재", "LI": "경기소비재", "NIO": "경기소비재",
    "XPEV": "경기소비재", "QS": "경기소비재",
    "GRAB": "산업재", "PLUG": "산업재", "RKLB": "산업재", "JOBY": "산업재", "BLDR": "산업재",
    "AVB": "부동산", "EQR": "부동산",
    "NVO": "헬스케어",
    "TAP": "필수소비재",
}

KR_MARKETS = {"KOSPI", "KOSDAQ"}


def _us_sector_map() -> dict[str, str]:
    resp = requests.get(universe.SP500_CSV, timeout=30)
    resp.raise_for_status()
    out = {}
    for row in csv.DictReader(io.StringIO(resp.text)):
        sym = (row.get("Symbol") or "").strip()
        sector = GICS_KO.get((row.get("GICS Sector") or "").strip())
        if sym and sector:
            out[sym] = sector
    return out


def fill_sectors(symbols: list[dict], only_missing: bool = True) -> None:
    targets = [s for s in symbols if not (only_missing and s.get("sector"))]
    if not targets:
        print("  업종: 채울 종목 없음")
        return
    us_map: dict[str, str] = {}
    if any(s["market"] not in KR_MARKETS for s in targets):
        try:
            us_map = _us_sector_map()
        except Exception as e:  # noqa: BLE001
            print(f"  [업종] S&P500 목록 조회 실패: {e}")
    done = miss = 0
    for s in targets:
        try:
            if s["market"] in KR_MARKETS:
                sector = kis_client.fetch_domestic_sector(s["ticker"])
            else:
                sector = us_map.get(s["ticker"]) or US_SECTOR_OVERRIDES.get(s["ticker"])
            if sector:
                supabase_io.patch("symbols", {"ticker": s["ticker"]}, {"sector": sector})
                done += 1
            else:
                miss += 1
        except Exception as e:  # noqa: BLE001
            miss += 1
            print(f"  [업종] {s['ticker']} 실패: {e}")
    print(f"  업종: {done}개 채움 · {miss}개 못 찾음")


def collect_investor_flows(symbols: list[dict]) -> None:
    kr = [s for s in symbols if s["market"] in KR_MARKETS]
    ok = fail = 0
    for s in kr:
        try:
            rows = kis_client.fetch_investor_flow(s["ticker"])
            supabase_io.upsert(
                "daily_investor_flow",
                [{"ticker": s["ticker"], "trade_date": kis_client.iso(r.pop("date")), **r} for r in rows],
                "ticker,trade_date",
            )
            ok += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  [투자자] {s['ticker']} 실패: {e}")
            traceback.print_exc()
    print(f"  투자자 동향: 성공 {ok} · 실패 {fail}")


def main(argv: list[str]):
    symbols = supabase_io.get_active_symbols()
    if "--flows" not in argv:
        fill_sectors(symbols, only_missing="--sectors" not in argv)
    if "--sectors" not in argv:
        collect_investor_flows(symbols)


if __name__ == "__main__":
    main(sys.argv[1:])
