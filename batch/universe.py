"""유니버스 확장: symbols 테이블에 대규모 종목을 적재.

- US: S&P500 (datahub 공개 CSV). 거래소는 배치가 자동 보정(NAS/NYS/AMS).
- KR: KOSPI/KOSDAQ 대형·중형 대표주 큐레이션 목록.
  (KOSPI200/KOSDAQ150 정확한 구성종목은 이 환경에서 KRX/pykrx가 응답하지 않아 큐레이션으로 대체.)

적재 후 run.py 로 배치를 돌리면 시세가 채워집니다.
데이터가 없는(상장폐지·오티커) 종목은 run.py --prune 로 정리하세요.

사용법: python universe.py            (적재)
"""
from __future__ import annotations

import csv
import io

import requests

import supabase_io

SP500_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv"

# KR 대표주 (티커, 시장, 한글명). 확신 있는 종목 위주. 무효 티커는 배치 후 정리됨.
KR_EXTRA = [
    # KOSPI
    ("034730", "KOSPI", "SK"), ("003550", "KOSPI", "LG"), ("017670", "KOSPI", "SK텔레콤"),
    ("030200", "KOSPI", "KT"), ("033780", "KOSPI", "KT&G"), ("009150", "KOSPI", "삼성전기"),
    ("010130", "KOSPI", "고려아연"), ("011200", "KOSPI", "HMM"), ("316140", "KOSPI", "우리금융지주"),
    ("086790", "KOSPI", "하나금융지주"), ("138040", "KOSPI", "메리츠금융지주"), ("032640", "KOSPI", "LG유플러스"),
    ("018260", "KOSPI", "삼성에스디에스"), ("000810", "KOSPI", "삼성화재"), ("090430", "KOSPI", "아모레퍼시픽"),
    ("051900", "KOSPI", "LG생활건강"), ("097950", "KOSPI", "CJ제일제당"), ("271560", "KOSPI", "오리온"),
    ("021240", "KOSPI", "코웨이"), ("010950", "KOSPI", "S-Oil"), ("011170", "KOSPI", "롯데케미칼"),
    ("034220", "KOSPI", "LG디스플레이"), ("042660", "KOSPI", "한화오션"), ("009540", "KOSPI", "HD한국조선해양"),
    ("010140", "KOSPI", "삼성중공업"), ("267250", "KOSPI", "HD현대"), ("000720", "KOSPI", "현대건설"),
    ("006360", "KOSPI", "GS건설"), ("161390", "KOSPI", "한국타이어앤테크놀로지"), ("004020", "KOSPI", "현대제철"),
    ("001040", "KOSPI", "CJ"), ("251270", "KOSPI", "넷마블"), ("259960", "KOSPI", "크래프톤"),
    ("036570", "KOSPI", "엔씨소프트"), ("302440", "KOSPI", "SK바이오사이언스"), ("012450", "KOSPI", "한화에어로스페이스"),
    ("000100", "KOSPI", "유한양행"), ("128940", "KOSPI", "한미약품"), ("047810", "KOSPI", "한국항공우주"),
    ("015760", "KOSPI", "한국전력"),
    # KOSDAQ
    ("058470", "KOSDAQ", "리노공업"), ("240810", "KOSDAQ", "원익IPS"), ("067310", "KOSDAQ", "하나마이크론"),
    ("214150", "KOSDAQ", "클래시스"), ("145020", "KOSDAQ", "휴젤"), ("141080", "KOSDAQ", "리가켐바이오"),
    ("028300", "KOSDAQ", "HLB"), ("253450", "KOSDAQ", "스튜디오드래곤"), ("213420", "KOSDAQ", "덕산네오룩스"),
    ("039030", "KOSDAQ", "이오테크닉스"), ("178920", "KOSDAQ", "PI첨단소재"), ("122870", "KOSDAQ", "와이지엔터테인먼트"),
    ("112040", "KOSDAQ", "위메이드"), ("263750", "KOSDAQ", "펄어비스"), ("095340", "KOSDAQ", "ISC"),
]


def _sp500() -> list[dict]:
    resp = requests.get(SP500_CSV, timeout=30)
    resp.raise_for_status()
    reader = csv.DictReader(io.StringIO(resp.text))
    rows = []
    for r in reader:
        sym = (r.get("Symbol") or "").strip()
        name = (r.get("Security") or "").strip()
        if not sym or "." in sym:  # 점 포함 티커(BRK.B 등)는 KIS 호환 이슈로 제외
            continue
        rows.append({
            "ticker": sym, "market": "NASDAQ", "name_ko": None, "name_en": name,
            "universe": ["SP500"], "currency": "USD",
        })
    return rows


def _kr() -> list[dict]:
    return [
        {"ticker": t, "market": m, "name_ko": n, "name_en": None,
         "universe": ["KOSPI200"] if m == "KOSPI" else ["KOSDAQ150"], "currency": "KRW"}
        for (t, m, n) in KR_EXTRA
    ]


def main():
    supabase_io.config.require_supabase()
    us = _sp500()
    kr = _kr()
    print(f"S&P500 {len(us)}종목 · KR 추가 {len(kr)}종목 적재…")
    supabase_io.upsert("symbols", us + kr, "ticker")
    print("완료. 이제 run.py 로 배치를 돌리세요. (거래소는 자동 보정됩니다)")


if __name__ == "__main__":
    main()
