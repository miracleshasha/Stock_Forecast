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
from us_ko_names import US_KO_NAMES

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
    # --- 확장분: KOSPI ---
    ("003490", "KOSPI", "대한항공"), ("011070", "KOSPI", "LG이노텍"),
    ("034020", "KOSPI", "두산에너빌리티"), ("241560", "KOSPI", "두산밥캣"), ("000150", "KOSPI", "두산"),
    ("042700", "KOSPI", "한미반도체"), ("064350", "KOSPI", "현대로템"), ("267260", "KOSPI", "HD현대일렉트릭"),
    ("010620", "KOSPI", "HD현대미포"), ("000880", "KOSPI", "한화"), ("009830", "KOSPI", "한화솔루션"),
    ("024110", "KOSPI", "기업은행"), ("138930", "KOSPI", "BNK금융지주"), ("175330", "KOSPI", "JB금융지주"),
    ("023530", "KOSPI", "롯데쇼핑"), ("004990", "KOSPI", "롯데지주"), ("018880", "KOSPI", "한온시스템"),
    ("161890", "KOSPI", "한국콜마"), ("035250", "KOSPI", "강원랜드"), ("008770", "KOSPI", "호텔신라"),
    ("006260", "KOSPI", "LS"), ("010120", "KOSPI", "LS ELECTRIC"), ("011790", "KOSPI", "SKC"),
    ("096770", "KOSPI", "SK이노베이션"), ("285130", "KOSPI", "SK케미칼"), ("030000", "KOSPI", "제일기획"),
    ("004370", "KOSPI", "농심"), ("280360", "KOSPI", "롯데웰푸드"), ("139480", "KOSPI", "이마트"),
    ("069960", "KOSPI", "현대백화점"), ("012750", "KOSPI", "에스원"), ("454910", "KOSPI", "두산로보틱스"),
    ("002790", "KOSPI", "아모레퍼시픽홀딩스"), ("011170", "KOSPI", "롯데케미칼"),
    # --- 확장분: KOSDAQ ---
    ("277810", "KOSDAQ", "레인보우로보틱스"), ("348370", "KOSDAQ", "엔켐"), ("091700", "KOSDAQ", "파트론"),
    ("137400", "KOSDAQ", "피엔티"), ("095610", "KOSDAQ", "테스"), ("222800", "KOSDAQ", "심텍"),
    ("036930", "KOSDAQ", "주성엔지니어링"), ("042000", "KOSDAQ", "카페24"), ("328130", "KOSDAQ", "루닛"),
    ("145720", "KOSDAQ", "덴티움"), ("214370", "KOSDAQ", "케어젠"), ("099190", "KOSDAQ", "아이센스"),
    ("178320", "KOSDAQ", "서진시스템"), ("067160", "KOSDAQ", "SOOP"), ("194480", "KOSDAQ", "데브시스터즈"),
    ("084850", "KOSDAQ", "아이티엠반도체"), ("293780", "KOSDAQ", "압타바이오"), ("200130", "KOSDAQ", "콜마비앤에이치"),
]

# 미국 성장주 (S&P500 밖, 국내 투자자 인기). (티커, 영문명, 한글명)
# 거래소는 배치가 자동 판별. 무효 티커는 배치 후 정리됨.
US_EXTRA = [
    ("IONQ", "IonQ", "아이온큐"), ("BE", "Bloom Energy", "블룸에너지"),
    ("SOFI", "SoFi Technologies", "소파이"), ("RIVN", "Rivian", "리비안"),
    ("LCID", "Lucid Group", "루시드"), ("JOBY", "Joby Aviation", "조비에비에이션"),
    ("RKLB", "Rocket Lab", "로켓랩"), ("HOOD", "Robinhood", "로빈후드"),
    ("NU", "Nu Holdings", "누홀딩스"), ("ARM", "Arm Holdings", "암홀딩스(ARM)"),
    ("MSTR", "MicroStrategy", "마이크로스트래티지"), ("CPNG", "Coupang", "쿠팡"),
    ("PLUG", "Plug Power", "플러그파워"), ("QS", "QuantumScape", "퀀텀스케이프"),
    ("RGTI", "Rigetti Computing", "리게티"), ("QBTS", "D-Wave Quantum", "디웨이브"),
    ("ASTS", "AST SpaceMobile", "에이에스티스페이스모바일"), ("SOUN", "SoundHound AI", "사운드하운드"),
    ("AI", "C3.ai", "씨쓰리에이아이(C3.ai)"), ("AFRM", "Affirm", "어펌"),
    ("UPST", "Upstart", "업스타트"), ("ROKU", "Roku", "로쿠"), ("CVNA", "Carvana", "카바나"),
    ("MARA", "MARA Holdings", "마라(마라톤디지털)"), ("RIOT", "Riot Platforms", "라이엇플랫폼스"),
    ("TSM", "Taiwan Semiconductor", "티에스엠씨(TSMC)"), ("ASML", "ASML", "에이에스엠엘(ASML)"),
    ("NVO", "Novo Nordisk", "노보노디스크"), ("BABA", "Alibaba", "알리바바"),
    ("PDD", "PDD Holdings", "핀둬둬"), ("NIO", "NIO", "니오"), ("LI", "Li Auto", "리오토"),
    ("XPEV", "XPeng", "샤오펑"), ("JD", "JD.com", "징둥닷컴"), ("SE", "Sea Limited", "씨(Sea)"),
    ("GRAB", "Grab Holdings", "그랩"), ("DKNG", "DraftKings", "드래프트킹스"), ("SNAP", "Snap", "스냅"),
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
            "ticker": sym, "market": "NASDAQ", "name_ko": US_KO_NAMES.get(sym), "name_en": name,
            "universe": ["SP500"], "currency": "USD",
        })
    return rows


def _kr() -> list[dict]:
    return [
        {"ticker": t, "market": m, "name_ko": n, "name_en": None,
         "universe": ["KOSPI200"] if m == "KOSPI" else ["KOSDAQ150"], "currency": "KRW"}
        for (t, m, n) in KR_EXTRA
    ]


def _us_extra() -> list[dict]:
    return [
        {"ticker": t, "market": "NASDAQ", "name_ko": ko, "name_en": en,
         "universe": ["US_EXTRA"], "currency": "USD"}
        for (t, en, ko) in US_EXTRA
    ]


def main():
    supabase_io.config.require_supabase()
    existing = {s["ticker"] for s in supabase_io.get_active_symbols()}
    rows = _sp500() + _kr() + _us_extra()
    # 티커 dedup + 신규만 선별 (기존 종목의 거래소/이름 보존)
    by_ticker: dict[str, dict] = {}
    for r in rows:
        by_ticker[r["ticker"]] = r
    new_rows = [r for t, r in by_ticker.items() if t not in existing]
    print(f"신규 {len(new_rows)}종목 적재 (기존 {len(existing)}종목 유지)…")
    if new_rows:
        supabase_io.upsert("symbols", new_rows, "ticker")
    print("완료. `run.py --missing` 로 새 종목만 수집하세요. (거래소 자동 보정)")


if __name__ == "__main__":
    main()
