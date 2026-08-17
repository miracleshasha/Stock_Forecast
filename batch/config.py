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
