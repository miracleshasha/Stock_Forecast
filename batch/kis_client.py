"""한국투자증권 KIS Developers REST 클라이언트.

일봉(국내/해외)과 국내 지수 일봉을 페이지네이션으로 수집합니다.
토큰은 파일에 캐시하며 만료 전까지 재사용합니다.
"""
from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone

import requests

import config

_YMD = "%Y%m%d"


def _today() -> datetime:
    return datetime.now()


# ---------------------------------------------------------------- 토큰
def _publish_token(token: str, expires_at: float):
    """웹(읽기 경로)이 현재가 조회에 쓸 수 있도록 토큰을 Supabase에 공유.

    웹이 직접 발급하지 않는 이유: KIS는 토큰 재발급에 분당 제한이 있고,
    서버리스는 콜드스타트마다 캐시가 날아가 발급을 반복하게 됩니다.
    발급은 배치가 하루 한 번만 하고 웹은 읽어 쓰기만 합니다.
    """
    if not (config.SUPABASE_URL and config.SUPABASE_SERVICE_ROLE_KEY):
        return
    try:
        import supabase_io  # 지연 임포트: 시세만 쓰는 스크립트에 Supabase를 강제하지 않음
        supabase_io.upsert("kis_token", [{
            "id": 1,
            "access_token": token,
            "expires_at": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }], "id")
    except Exception as e:  # noqa: BLE001
        print(f"  [kis] 토큰 공유 실패(배치는 계속 진행): {e}")


def get_access_token() -> str:
    cache = config.TOKEN_CACHE
    if cache.exists():
        try:
            data = json.loads(cache.read_text())
            # 만료 직전까지 쓰지 않고 여유를 두고 갱신합니다. 장중에 만료되면
            # 웹의 실시간 현재가가 다음 배치까지 종가로 폴백해 버립니다.
            margin = config.TOKEN_MIN_REMAINING_HOURS * 3600
            if data.get("expires_at", 0) > time.time() + margin:
                return data["access_token"]
        except Exception:
            pass

    resp = requests.post(
        f"{config.KIS_BASE_URL}/oauth2/tokenP",
        json={
            "grant_type": "client_credentials",
            "appkey": config.KIS_APP_KEY,
            "appsecret": config.KIS_APP_SECRET,
        },
        timeout=15,
    )
    resp.raise_for_status()
    body = resp.json()
    token = body["access_token"]
    expires_in = int(body.get("expires_in", 86400))
    expires_at = time.time() + expires_in
    cache.write_text(json.dumps({"access_token": token, "expires_at": expires_at}))
    _publish_token(token, expires_at)
    return token


def _headers(tr_id: str) -> dict:
    return {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {get_access_token()}",
        "appkey": config.KIS_APP_KEY,
        "appsecret": config.KIS_APP_SECRET,
        "tr_id": tr_id,
        "custtype": "P",
    }


def _get(path: str, tr_id: str, params: dict) -> dict:
    url = f"{config.KIS_BASE_URL}{path}"
    for attempt in range(3):
        resp = requests.get(url, headers=_headers(tr_id), params=params, timeout=20)
        if resp.status_code == 200:
            time.sleep(config.REQUEST_DELAY_SEC)
            return resp.json()
        if resp.status_code in (429, 500, 502, 503):
            time.sleep(1.0 + attempt)
            continue
        resp.raise_for_status()
    resp.raise_for_status()
    return {}


def _f(v) -> float | None:
    try:
        if v in (None, "", "-"):
            return None
        return float(v)
    except (TypeError, ValueError):
        return None


def _pick(row: dict, *keys):
    for k in keys:
        if k in row and row[k] not in (None, ""):
            return row[k]
    return None


# ---------------------------------------------------------------- 국내 일봉
def fetch_domestic_daily(code: str, target_rows: int) -> list[dict]:
    """국내 종목 일봉. 오래된 날짜 → 최신 날짜 순으로 반환."""
    path = "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice"
    out: dict[str, dict] = {}
    end = _today()

    while len(out) < target_rows:
        start = end - timedelta(days=140)  # 영업일 100건 여유
        params = {
            "FID_COND_MRKT_DIV_CODE": "J",
            "FID_INPUT_ISCD": code,
            "FID_INPUT_DATE_1": start.strftime(_YMD),
            "FID_INPUT_DATE_2": end.strftime(_YMD),
            "FID_PERIOD_DIV_CODE": "D",
            "FID_ORG_ADJ_PRC": "0",
        }
        data = _get(path, "FHKST03010100", params)
        rows = data.get("output2") or []
        rows = [r for r in rows if r.get("stck_bsop_date")]
        if not rows:
            break
        for r in rows:
            d = r["stck_bsop_date"]
            out[d] = {
                "date": d,
                "open": _f(r.get("stck_oprc")),
                "high": _f(r.get("stck_hgpr")),
                "low": _f(r.get("stck_lwpr")),
                "close": _f(r.get("stck_clpr")),
                "volume": int(_f(r.get("acml_vol")) or 0),
            }
        earliest = min(rows, key=lambda r: r["stck_bsop_date"])["stck_bsop_date"]
        new_end = datetime.strptime(earliest, _YMD) - timedelta(days=1)
        if new_end >= end:
            break
        end = new_end

    return _finalize(out, target_rows)


# ---------------------------------------------------------------- 해외 일봉
EXCD_BY_MARKET = {"NASDAQ": "NAS", "NYSE": "NYS", "AMEX": "AMS"}
EXCD_TO_MARKET = {"NAS": "NASDAQ", "NYS": "NYSE", "AMS": "AMEX"}
_EXCD_ORDER = ["NAS", "NYS", "AMS"]


def _overseas_pages(symbol: str, excd: str, target_rows: int) -> dict:
    """단일 거래소(excd)에서 페이지네이션 수집. 첫 페이지가 비면 즉시 반환(=거래소 불일치)."""
    path = "/uapi/overseas-price/v1/quotations/dailyprice"
    out: dict[str, dict] = {}
    bymd = _today().strftime(_YMD)
    for _ in range(20):  # 최대 20페이지(약 2000거래일) 안전장치
        if len(out) >= target_rows:
            break
        params = {"AUTH": "", "EXCD": excd, "SYMB": symbol, "GUBN": "0", "BYMD": bymd, "MODP": "1"}
        data = _get(path, "HHDFS76240000", params)
        rows = [r for r in (data.get("output2") or []) if _pick(r, "xymd")]
        if not rows:
            break
        for r in rows:
            d = _pick(r, "xymd")
            out[d] = {
                "date": d,
                "open": _f(_pick(r, "open")),
                "high": _f(_pick(r, "high")),
                "low": _f(_pick(r, "low")),
                "close": _f(_pick(r, "clos", "last")),
                "volume": int(_f(_pick(r, "tvol")) or 0),
            }
        earliest = min(rows, key=lambda r: _pick(r, "xymd"))["xymd"]
        new_bymd = (datetime.strptime(earliest, _YMD) - timedelta(days=1)).strftime(_YMD)
        if new_bymd >= bymd:
            break
        bymd = new_bymd
    return out


def fetch_overseas_daily(symbol: str, market: str, target_rows: int) -> tuple[list[dict], str]:
    """해외 종목 일봉. (rows, 실제거래소_market) 반환.

    저장된 market의 거래소를 먼저 시도하고, 비면 NAS→NYS→AMS 순으로 탐색합니다.
    호출자는 반환된 실제 거래소로 symbols.market 을 보정할 수 있습니다.
    """
    first = EXCD_BY_MARKET.get(market, "NAS")
    order = [first] + [e for e in _EXCD_ORDER if e != first]
    for excd in order:
        out = _overseas_pages(symbol, excd, target_rows)
        if out:
            return _finalize(out, target_rows), EXCD_TO_MARKET[excd]
    return [], market


# ---------------------------------------------------------------- 국내 지수 일봉
def fetch_domestic_index_daily(code: str, target_rows: int) -> list[dict]:
    """국내 지수 일봉(KOSPI=0001, KOSDAQ=1001 등). [{date, close}] 반환."""
    path = "/uapi/domestic-stock/v1/quotations/inquire-daily-indexchartprice"
    out: dict[str, dict] = {}
    end = _today()

    while len(out) < target_rows:
        start = end - timedelta(days=140)
        params = {
            "FID_COND_MRKT_DIV_CODE": "U",
            "FID_INPUT_ISCD": code,
            "FID_INPUT_DATE_1": start.strftime(_YMD),
            "FID_INPUT_DATE_2": end.strftime(_YMD),
            "FID_PERIOD_DIV_CODE": "D",
        }
        try:
            data = _get(path, "FHKUP03500100", params)
        except requests.HTTPError:
            break
        rows = data.get("output2") or []
        rows = [r for r in rows if r.get("stck_bsop_date")]
        if not rows:
            break
        for r in rows:
            d = r["stck_bsop_date"]
            out[d] = {"date": d, "close": _f(_pick(r, "bstp_nmix_prpr", "bstp_nmix_prc", "clpr"))}
        earliest = min(rows, key=lambda r: r["stck_bsop_date"])["stck_bsop_date"]
        new_end = datetime.strptime(earliest, _YMD) - timedelta(days=1)
        if new_end >= end:
            break
        end = new_end

    rows = sorted(out.values(), key=lambda x: x["date"])
    return rows[-target_rows:]


def _finalize(out: dict, target_rows: int) -> list[dict]:
    rows = [r for r in out.values() if r["close"] is not None]
    rows.sort(key=lambda x: x["date"])  # 오름차순
    return rows[-target_rows:]


def iso(d: str) -> str:
    """YYYYMMDD → YYYY-MM-DD"""
    return f"{d[0:4]}-{d[4:6]}-{d[6:8]}"


if __name__ == "__main__":
    # 캐시에 있는 토큰을 Supabase(kis_token)에 즉시 공유합니다.
    # 테이블을 새로 만든 직후처럼, 다음 발급(하루 1회)까지 기다리기 곤란할 때 사용.
    #   .venv/bin/python kis_client.py --publish-token
    import sys

    if "--publish-token" in sys.argv:
        tok = get_access_token()
        meta = json.loads(config.TOKEN_CACHE.read_text())
        _publish_token(tok, meta["expires_at"])
        print("토큰 공유 완료 (kis_token)")
    else:
        print("사용법: python kis_client.py --publish-token")
