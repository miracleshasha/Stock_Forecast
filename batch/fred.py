"""FRED(미 세인트루이스 연준) 시계열 수집.

API 키 없이 공개 CSV 엔드포인트(fredgraph.csv)를 사용합니다.
결측치('.')는 건너뛰고 최근 값만 취합니다.
"""
from __future__ import annotations

import csv
import io

import requests

BASE = "https://fred.stlouisfed.org/graph/fredgraph.csv"


def fetch_series(series_id: str, limit: int = 30) -> list[tuple[str, float]]:
    """[(date, value)] 오름차순, 최근 limit개. 실패 시 예외 전파."""
    resp = requests.get(BASE, params={"id": series_id}, timeout=30)
    resp.raise_for_status()
    rows: list[tuple[str, float]] = []
    reader = csv.reader(io.StringIO(resp.text))
    next(reader, None)  # header
    for row in reader:
        if len(row) < 2:
            continue
        d, v = row[0].strip(), row[1].strip()
        if v in (".", ""):
            continue
        try:
            rows.append((d, float(v)))
        except ValueError:
            continue
    return rows[-limit:]
