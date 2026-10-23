"""유니버스 확대 (2026-10-24): KOSPI200 + KOSDAQ150, 국내 ETF 40, 미국 ETF 40.

- 국내 지수 구성종목은 KIS 공식 종목 마스터(kis_master.py)에서 읽습니다.
  기존 국내 133종목 중 지수 밖 8종목은 즐겨찾기 때문에 그대로 둡니다.
- ETF 는 규모 상위에서 겹치는 지수(같은 S&P500 을 여러 운용사가 내는 등)를 하나만 남기고,
  레버리지·인버스(매일 수익률을 다시 맞춰 차트 신호가 왜곡됨)와 머니마켓·단기채(거의 안 움직임)는 뺐습니다.
- 새 종목만 넣습니다(기존 행은 건드리지 않음). 시세는 이어서 `python run.py --missing` 으로 채웁니다.

사용법: python universe_expand.py          (적재)
        python universe_expand.py --dry    (넣을 목록만 출력)
"""
from __future__ import annotations

import sys

import kis_master
import supabase_io

# 국내 ETF (코드) — KIS 마스터 규모 순, 2026-10-23 기준 선정
KR_ETF = [
    "069500",  # KODEX 200
    "229200",  # KODEX 코스닥150
    "310970",  # TIGER MSCI Korea TR
    "292150",  # TIGER 코리아TOP10
    "102780",  # KODEX 삼성그룹
    "495050",  # RISE 코리아밸류업
    "161510",  # PLUS 고배당주
    "466940",  # TIGER 은행고배당플러스TOP10
    "139260",  # TIGER 200 IT
    "396500",  # TIGER 반도체TOP10
    "091160",  # KODEX 반도체
    "0167A0",  # SOL AI반도체TOP2플러스
    "455850",  # SOL AI반도체소부장
    "305720",  # KODEX 2차전지산업
    "364980",  # TIGER 2차전지TOP10
    "487240",  # KODEX AI전력핵심설비
    "0117V0",  # TIGER 코리아AI전력기기TOP3플러스
    "0091P0",  # TIGER 코리아원자력
    "466920",  # SOL 조선TOP3플러스
    "449450",  # PLUS K방산
    "0148J0",  # TIGER 코리아휴머노이드로봇산업
    "102970",  # KODEX 증권
    "138540",  # TIGER 현대차그룹플러스
    "329200",  # TIGER 리츠부동산인프라
    "360750",  # TIGER 미국S&P500
    "133690",  # TIGER 미국나스닥100
    "458730",  # TIGER 미국배당다우존스
    "381170",  # TIGER 미국테크TOP10 INDXX
    "465580",  # ACE 미국빅테크TOP7 Plus
    "381180",  # TIGER 미국필라델피아반도체나스닥
    "390390",  # KODEX 미국반도체
    "446770",  # ACE 글로벌반도체TOP4 Plus
    "442580",  # PLUS 글로벌HBM반도체
    "487230",  # KODEX 미국AI전력핵심인프라
    "0183J0",  # TIGER 미국우주테크
    "371460",  # TIGER 차이나전기차SOLACTIVE
    "371160",  # TIGER 차이나항셍테크
    "411060",  # ACE KRX금현물
    "284430",  # KODEX 200미국채혼합50
    "365780",  # ACE 국고채10년
]

# 미국 ETF (티커, 영문명, 한글 검색명). 거래소는 배치가 자동 보정(NYSE Arca → AMEX)
US_ETF = [
    ("SPY", "SPDR S&P 500 ETF", "미국 S&P500 ETF (SPY)"),
    ("QQQ", "Invesco QQQ Trust", "미국 나스닥100 ETF (QQQ)"),
    ("DIA", "SPDR Dow Jones Industrial Average ETF", "미국 다우존스 ETF (DIA)"),
    ("IWM", "iShares Russell 2000 ETF", "미국 러셀2000 소형주 ETF (IWM)"),
    ("VTI", "Vanguard Total Stock Market ETF", "미국 전체시장 ETF (VTI)"),
    ("XLK", "Technology Select Sector SPDR", "미국 기술 섹터 ETF (XLK)"),
    ("XLF", "Financial Select Sector SPDR", "미국 금융 섹터 ETF (XLF)"),
    ("XLV", "Health Care Select Sector SPDR", "미국 헬스케어 섹터 ETF (XLV)"),
    ("XLE", "Energy Select Sector SPDR", "미국 에너지 섹터 ETF (XLE)"),
    ("XLI", "Industrial Select Sector SPDR", "미국 산업재 섹터 ETF (XLI)"),
    ("XLY", "Consumer Discretionary Select Sector SPDR", "미국 경기소비재 섹터 ETF (XLY)"),
    ("XLP", "Consumer Staples Select Sector SPDR", "미국 필수소비재 섹터 ETF (XLP)"),
    ("XLU", "Utilities Select Sector SPDR", "미국 유틸리티 섹터 ETF (XLU)"),
    ("XLB", "Materials Select Sector SPDR", "미국 소재 섹터 ETF (XLB)"),
    ("XLRE", "Real Estate Select Sector SPDR", "미국 부동산 섹터 ETF (XLRE)"),
    ("XLC", "Communication Services Select Sector SPDR", "미국 커뮤니케이션 섹터 ETF (XLC)"),
    ("SMH", "VanEck Semiconductor ETF", "미국 반도체 ETF (SMH)"),
    ("SOXX", "iShares Semiconductor ETF", "미국 반도체 ETF (SOXX)"),
    ("IGV", "iShares Expanded Tech-Software ETF", "미국 소프트웨어 ETF (IGV)"),
    ("ARKK", "ARK Innovation ETF", "아크 혁신 ETF (ARKK)"),
    ("XBI", "SPDR S&P Biotech ETF", "미국 바이오 ETF (XBI)"),
    ("KRE", "SPDR S&P Regional Banking ETF", "미국 지역은행 ETF (KRE)"),
    ("ITA", "iShares U.S. Aerospace & Defense ETF", "미국 항공우주·방산 ETF (ITA)"),
    ("ICLN", "iShares Global Clean Energy ETF", "글로벌 클린에너지 ETF (ICLN)"),
    ("VNQ", "Vanguard Real Estate ETF", "미국 리츠 ETF (VNQ)"),
    ("SCHD", "Schwab U.S. Dividend Equity ETF", "미국 배당 ETF (SCHD)"),
    ("MTUM", "iShares MSCI USA Momentum Factor ETF", "미국 모멘텀 팩터 ETF (MTUM)"),
    ("TLT", "iShares 20+ Year Treasury Bond ETF", "미국 장기국채 ETF (TLT)"),
    ("IEF", "iShares 7-10 Year Treasury Bond ETF", "미국 중기국채 ETF (IEF)"),
    ("LQD", "iShares iBoxx Investment Grade Corporate Bond ETF", "미국 투자등급 회사채 ETF (LQD)"),
    ("HYG", "iShares iBoxx High Yield Corporate Bond ETF", "미국 하이일드 채권 ETF (HYG)"),
    ("GLD", "SPDR Gold Shares", "금 ETF (GLD)"),
    ("SLV", "iShares Silver Trust", "은 ETF (SLV)"),
    ("USO", "United States Oil Fund", "원유 ETF (USO)"),
    ("EFA", "iShares MSCI EAFE ETF", "선진국(미국 제외) ETF (EFA)"),
    ("EEM", "iShares MSCI Emerging Markets ETF", "신흥국 ETF (EEM)"),
    ("FXI", "iShares China Large-Cap ETF", "중국 대형주 ETF (FXI)"),
    ("EWJ", "iShares MSCI Japan ETF", "일본 ETF (EWJ)"),
    ("EWY", "iShares MSCI South Korea ETF", "한국 ETF (EWY)"),
    ("INDA", "iShares MSCI India ETF", "인도 ETF (INDA)"),
]


def build() -> list[dict]:
    existing = {s["ticker"] for s in supabase_io.get_active_symbols()}
    k200, q150 = kis_master.index_members()
    kospi_all = {r["code"]: r for r in kis_master.kospi()}
    rows: list[dict] = []

    def add(row: dict):
        if row["ticker"] not in existing and all(r["ticker"] != row["ticker"] for r in rows):
            rows.append(row)

    for r in k200:
        add({"ticker": r["code"], "market": "KOSPI", "name_ko": r["name"], "currency": "KRW",
             "universe": ["KOSPI200"], "kind": "stock", "is_active": True})
    for r in q150:
        add({"ticker": r["code"], "market": "KOSDAQ", "name_ko": r["name"], "currency": "KRW",
             "universe": ["KOSDAQ150"], "kind": "stock", "is_active": True})
    for code in KR_ETF:
        r = kospi_all.get(code)
        if not r or r["group"] != "EF":
            print(f"  [건너뜀] 국내 ETF {code}: 마스터에 없음")
            continue
        add({"ticker": code, "market": "KOSPI", "name_ko": r["name"], "currency": "KRW",
             "universe": ["ETF"], "kind": "etf", "sector": "ETF", "is_active": True})
    for t, en, ko in US_ETF:
        add({"ticker": t, "market": "NASDAQ", "name_ko": ko, "name_en": en, "currency": "USD",
             "universe": ["ETF"], "kind": "etf", "sector": "ETF", "is_active": True})
    return rows


def main(argv):
    rows = build()
    by = {}
    for r in rows:
        key = ("ETF " if r["kind"] == "etf" else "") + r["currency"]
        by[key] = by.get(key, 0) + 1
    print(f"새로 넣을 종목 {len(rows)}개: {by}")
    if "--dry" in argv:
        for r in rows[:10]:
            print("  ", r["ticker"], r["name_ko"])
        return
    # 열 구성이 같은 묶음끼리 보내야 PostgREST 일괄 삽입이 됩니다
    for kind in ("stock", "etf"):
        for cur in ("KRW", "USD"):
            part = [r for r in rows if r["kind"] == kind and r["currency"] == cur]
            if part:
                supabase_io.upsert("symbols", part, "ticker")
    print("적재 완료 — 이어서 `python run.py --missing` 으로 시세를 채우세요.")


if __name__ == "__main__":
    main(sys.argv[1:])
