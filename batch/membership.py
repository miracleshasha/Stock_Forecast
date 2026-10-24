"""지수 구성종목 변경 이력 기록 (생존편향 보정용, 2026-10-24~).

배치마다 KOSPI200·KOSDAQ150(KIS 종목 마스터)과 S&P500(datahub CSV)의 현재 구성을 받아
universe_membership 에 바뀐 것만 남깁니다. 편입은 새 행, 편출은 열린 행의 valid_to 를 채웁니다.
받아온 목록이 비정상적으로 작으면(다운로드 오류 등) 대량 편출로 잘못 기록되지 않도록 그 지수는 건너뜁니다.

사용법: python membership.py          (전체 기록)
        python membership.py --dry    (바뀔 내용만 출력)
"""
from __future__ import annotations

import csv
import io
import sys
from datetime import datetime, timedelta, timezone

import requests

import kis_master
import supabase_io
import universe

KST = timezone(timedelta(hours=9))
# 이 수보다 적게 받아지면 목록 오류로 보고 그 지수는 건너뜁니다
MIN_SIZE = {"KOSPI200": 190, "KOSDAQ150": 140, "SP500": 480}


def _sp500() -> dict[str, str]:
    resp = requests.get(universe.SP500_CSV, timeout=30)
    resp.raise_for_status()
    return {
        (r.get("Symbol") or "").strip(): (r.get("Security") or "").strip()
        for r in csv.DictReader(io.StringIO(resp.text))
        if (r.get("Symbol") or "").strip()
    }


def current(indexes: tuple[str, ...]) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    if "KOSPI200" in indexes or "KOSDAQ150" in indexes:
        k200, q150 = kis_master.index_members()
        out["KOSPI200"] = {r["code"]: r["name"] for r in k200}
        out["KOSDAQ150"] = {r["code"]: r["name"] for r in q150}
    if "SP500" in indexes:
        out["SP500"] = _sp500()
    return {k: v for k, v in out.items() if k in indexes}


def snapshot(indexes: tuple[str, ...] = ("KOSPI200", "KOSDAQ150", "SP500"), dry: bool = False) -> None:
    today = datetime.now(KST).date().isoformat()
    for index_name, members in current(indexes).items():
        if len(members) < MIN_SIZE[index_name]:
            print(f"  [구성종목] {index_name} {len(members)}개만 받아짐 — 목록 오류로 보고 건너뜀")
            continue
        open_rows = supabase_io.select("universe_membership", {
            "select": "ticker,valid_from", "index_name": f"eq.{index_name}", "valid_to": "is.null",
        })
        have = {r["ticker"] for r in open_rows}
        added = sorted(set(members) - have)
        removed = sorted(have - set(members))
        first = not have
        print(f"  [구성종목] {index_name} {len(members)}개 · "
              + ("첫 기록" if first else f"편입 {len(added)} · 편출 {len(removed)}")
              + ("" if first or not (added or removed) else f" ({', '.join(added[:5] + ['-' + t for t in removed[:5]])})"))
        if dry:
            continue
        supabase_io.upsert("universe_membership", [
            {"index_name": index_name, "ticker": t, "name": members[t], "valid_from": today, "valid_to": None}
            for t in added
        ], "index_name,ticker,valid_from")
        for t in removed:
            supabase_io.patch_open_membership(index_name, t, today)


def main(argv):
    supabase_io.config.require_supabase()
    snapshot(dry="--dry" in argv)


if __name__ == "__main__":
    main(sys.argv[1:])
