"""환경설정 로딩. batch/.env (또는 프로세스 환경변수)에서 읽습니다."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def _load_dotenv(path: Path):
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        os.environ.setdefault(key, val)


_load_dotenv(BASE_DIR / ".env")


def _get(key: str, default: str = "") -> str:
    return os.environ.get(key, default)


# ---- KIS (한국투자증권) ----
KIS_APP_KEY = _get("KIS_APP_KEY")
KIS_APP_SECRET = _get("KIS_APP_SECRET")
# 실전투자: https://openapi.koreainvestment.com:9443
# 모의투자: https://openapivts.koreainvestment.com:29443
KIS_BASE_URL = _get("KIS_BASE_URL", "https://openapi.koreainvestment.com:9443")

# ---- Supabase ----
SUPABASE_URL = _get("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = _get("SUPABASE_SERVICE_ROLE_KEY")

# ---- 배치 파라미터 ----
# 조회할 최대 거래일 수. 지표 워밍업(MA120)을 위해 최소 150 이상 권장.
# 3Y 차트까지 채우려면 800 이상으로 늘리세요(KIS 호출 횟수 증가).
LOOKBACK_TRADING_DAYS = int(_get("LOOKBACK_TRADING_DAYS", "400"))

# API 호출 간 지연(초). KIS 유량제한 회피용.
REQUEST_DELAY_SEC = float(_get("REQUEST_DELAY_SEC", "0.2"))

# ---- 증분 수집(하이브리드) ----
# 평일 배치는 "마지막 저장일 이후"만 KIS에서 받아오고(증분), 지표 워밍업에 필요한
# 과거 구간은 Supabase(daily_prices)에서 읽어 이어붙입니다.
# 주말 배치(run.py --full)는 400일 전체를 다시 받아 수정주가·누락분을 정리합니다.
#
# DB에서 읽어올 워밍업 행수. MA120 + OBV 20일 추세 + MACD(EMA26) 수렴을 위해
# 최소 200 이상 권장. 클수록 지표가 전량 재조회 결과에 가까워집니다.
WARMUP_ROWS = int(_get("WARMUP_ROWS", "250"))

# 증분 조회 시 최소로 요청할 행수(휴장 연휴 등으로 갭이 0에 가까울 때의 하한).
MIN_INCREMENTAL_ROWS = int(_get("MIN_INCREMENTAL_ROWS", "5"))

# 증분 모드에서도 최근 N거래일은 다시 받아 덮어씁니다.
# 전량 재조회가 갖고 있던 "지난 며칠은 다음 실행이 알아서 고친다"는 자가치유 성질을
# 유지하기 위한 장치입니다(거래량 정정, 미완성 행 등).
REVISION_ROWS = int(_get("REVISION_ROWS", "3"))

# 해외 종목: 정규장이 끝나지 않은 날짜의 행을 저장하지 않습니다.
# KIS는 미국장 개장 전에도 그날 날짜의 행을 프리마켓 체결분만 담아 내려줍니다
# (예: NVDA 2026-09-04 거래량 41만 vs 정규장 1.35억). 전량 재조회 시절에는 다음 날
# 덮어써져 자연히 고쳐졌지만, 증분에서는 그대로 굳으므로 아예 걸러냅니다.
# 미국장 D일 종가는 D+1 05:00 KST 확정 → 1시간 여유를 둬 06:00 이후를 완료로 판정.
SKIP_INCOMPLETE_OVERSEAS = _get("SKIP_INCOMPLETE_OVERSEAS", "1").lower() not in ("0", "false", "no")
# D 00:00 기준 +31h = D+1 07:00 KST. 서머타임 해제기(미국장 마감 06:00 KST)에도
# 1시간 여유가 남도록 잡았습니다. 해외 배치를 07:00에 돌리는 근거이기도 합니다.
OVERSEAS_SETTLE_HOURS = int(_get("OVERSEAS_SETTLE_HOURS", "31"))

# 국내 지수 코드 (KIS 국내지수 일봉 조회용)
KOSPI_INDEX_CODE = _get("KOSPI_INDEX_CODE", "0001")
# VKOSPI 지수 코드. 확인 후 채우세요(비우면 매크로에서 VKOSPI 생략).
VKOSPI_INDEX_CODE = _get("VKOSPI_INDEX_CODE", "")

TOKEN_CACHE = BASE_DIR / ".kis_token.json"


def require_kis():
    if not KIS_APP_KEY or not KIS_APP_SECRET:
        raise SystemExit(
            "KIS_APP_KEY / KIS_APP_SECRET 가 설정되지 않았습니다. batch/.env 를 확인하세요."
        )


def require_supabase():
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        raise SystemExit(
            "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다. batch/.env 를 확인하세요."
        )
