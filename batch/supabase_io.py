"""Supabase(PostgREST) 업서트/조회. supabase-py 없이 requests로 직접 호출."""
from __future__ import annotations

import requests

import config


def _headers(extra: dict | None = None) -> dict:
    h = {
        "apikey": config.SUPABASE_SERVICE_ROLE_KEY,
        "authorization": f"Bearer {config.SUPABASE_SERVICE_ROLE_KEY}",
        "content-type": "application/json",
    }
    if extra:
        h.update(extra)
    return h


def get_active_symbols() -> list[dict]:
    """대상 종목 목록. batch는 이 테이블을 읽어 수집 대상을 정합니다."""
    url = f"{config.SUPABASE_URL}/rest/v1/symbols"
    params = {
        "select": "ticker,market,name_ko,name_en,currency,is_active",
        "is_active": "eq.true",
        "limit": "10000",  # PostgREST 기본 1000행 캡 회피
    }
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def get_prices(ticker: str) -> list[dict]:
    """종목 일봉 전체(오름차순). 백테스트/재계산용."""
    url = f"{config.SUPABASE_URL}/rest/v1/daily_prices"
    params = {
        "select": "trade_date,open,high,low,close,volume",
        "ticker": f"eq.{ticker}",
        "order": "trade_date.asc",
        "limit": "2000",
    }
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    # indicators.compute 가 기대하는 date(YYYYMMDD) 형식으로 변환
    for r in rows:
        r["date"] = r["trade_date"].replace("-", "")
    return rows


def get_recent_prices(ticker: str, limit: int) -> list[dict]:
    """최근 일봉 N행(오름차순). 증분 수집의 지표 워밍업 구간으로 사용.

    실패하면 빈 리스트를 돌려주고, 호출자는 전량 재조회로 폴백합니다.
    """
    url = f"{config.SUPABASE_URL}/rest/v1/daily_prices"
    params = {
        "select": "trade_date,open,high,low,close,volume",
        "ticker": f"eq.{ticker}",
        "order": "trade_date.desc",
        "limit": str(limit),
    }
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    rows.reverse()  # desc로 받아 최근 N행을 고른 뒤 오름차순으로 되돌림
    for r in rows:
        r["date"] = r["trade_date"].replace("-", "")
    return rows


def get_obv_at(ticker: str, date_ymd: str) -> float | None:
    """특정 거래일(YYYYMMDD)에 저장돼 있는 OBV 값.

    OBV는 누적합이라 계산 구간이 달라지면 절대값이 통째로 어긋납니다.
    증분 계산 결과를 이 기준점에 맞춰 평행이동시켜 DB 시계열의 연속성을 유지합니다.
    (기준점은 이번에 덮어쓰지 않는 날짜여야 하므로 재검증 윈도우 바로 앞을 씁니다.)
    """
    iso = f"{date_ymd[0:4]}-{date_ymd[4:6]}-{date_ymd[6:8]}"
    url = f"{config.SUPABASE_URL}/rest/v1/daily_indicators"
    params = {
        "select": "obv",
        "ticker": f"eq.{ticker}",
        "trade_date": f"eq.{iso}",
        "limit": "1",
    }
    resp = requests.get(url, headers=_headers(), params=params, timeout=30)
    resp.raise_for_status()
    rows = resp.json()
    if not rows or rows[0].get("obv") is None:
        return None
    return float(rows[0]["obv"])


def get_signal_tickers() -> set[str]:
    """시세가 채워진 ticker 집합.

    daily_signals는 날짜별로 여러 행이 쌓이므로(>1000행), 티커당 1행인
    v_latest_signal 뷰를 조회해 PostgREST 1000행 캡 문제를 피한다.
    """
    url = f"{config.SUPABASE_URL}/rest/v1/v_latest_signal"
    resp = requests.get(url, headers=_headers(), params={"select": "ticker", "limit": "10000"}, timeout=30)
    resp.raise_for_status()
    return {r["ticker"] for r in resp.json()}


def delete_symbols(tickers: list[str]):
    """symbols 삭제(자식 테이블은 ON DELETE CASCADE). 청크 단위."""
    if not tickers:
        return
    url = f"{config.SUPABASE_URL}/rest/v1/symbols"
    for i in range(0, len(tickers), 100):
        part = tickers[i : i + 100]
        lst = ",".join(f'"{t}"' for t in part)
        resp = requests.delete(url, headers=_headers(), params={"ticker": f"in.({lst})"}, timeout=60)
        if resp.status_code >= 300:
            raise RuntimeError(f"delete 실패 [{resp.status_code}]: {resp.text[:300]}")


def patch(table: str, match: dict, body: dict):
    """기존 행만 부분 업데이트(PATCH). 삽입/다른 컬럼 영향 없음."""
    url = f"{config.SUPABASE_URL}/rest/v1/{table}"
    params = {k: f"eq.{v}" for k, v in match.items()}
    resp = requests.patch(
        url, headers=_headers({"prefer": "return=minimal"}), params=params, json=body, timeout=30
    )
    if resp.status_code >= 300:
        raise RuntimeError(f"patch {table} 실패 [{resp.status_code}]: {resp.text[:300]}")


def upsert(table: str, rows: list[dict], on_conflict: str, chunk: int = 500):
    """merge-duplicates 업서트. rows를 chunk 단위로 나눠 전송."""
    if not rows:
        return
    url = f"{config.SUPABASE_URL}/rest/v1/{table}"
    headers = _headers({"prefer": "resolution=merge-duplicates,return=minimal"})
    for i in range(0, len(rows), chunk):
        part = rows[i : i + chunk]
        resp = requests.post(
            url, headers=headers, params={"on_conflict": on_conflict}, json=part, timeout=60
        )
        if resp.status_code >= 300:
            raise RuntimeError(f"upsert {table} 실패 [{resp.status_code}]: {resp.text[:400]}")
