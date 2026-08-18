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
