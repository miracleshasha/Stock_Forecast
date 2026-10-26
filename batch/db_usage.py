"""DB 용량 주간 추적 (2026-10-26).

무료 플랜 500MB 한도에 언제 닿는지는 한 번 재서는 알 수 없습니다. 토요일 전량 배치가
끝날 때 그날 용량을 `db_usage` 에 한 줄 남기고(`record_db_usage` RPC), 쌓인 기록으로
주당 증가량과 도달 예상 시점을 계산합니다.

추세는 **마지막으로 용량이 줄어든 측정 이후**만 씁니다. 인덱스 정리나 행 삭제로 한 번
꺾이면 그 전 구간까지 묶어 재면 기울기가 음수로 나와 "영원히 안 찬다"는 잘못된 답이
나오기 때문입니다(2026-10-26 중복 인덱스 정리로 303MB → 241MB).

사용법: python db_usage.py              # 측정·기록 + 추세 보고
        python db_usage.py --report     # 기록하지 않고 쌓인 기록만 보고
        python db_usage.py --limit 500  # 한도를 MB 로 지정(기본 500, 무료 플랜)
"""
from __future__ import annotations

import sys
from datetime import date, timedelta

import supabase_io

# Supabase 무료 플랜 DB 한도. 유료로 올리면 --limit 으로 바꿔 부르세요.
DEFAULT_LIMIT_MB: int = 500

# 추세 계산에 쓸 최대 측정 수. 주 1회 기준 약 6개월.
MAX_POINTS: int = 26

# 이만큼(바이트) 이상 줄어든 측정을 "정리가 있었던 지점"으로 봅니다.
# 측정 시각 차이로 생기는 수 MB 흔들림을 정리로 오해하지 않기 위한 하한입니다.
DROP_THRESHOLD: int = 20 * 1024 * 1024

MB: int = 1024 * 1024


def mb(n: float) -> str:
    """바이트를 'NNN.NMB' 로."""
    return f"{n / MB:.1f}MB"


def _ols_slope(xs: list[float], ys: list[float]) -> float:
    """최소제곱 기울기(단위: y/x). 점이 2개 미만이거나 x가 모두 같으면 0."""
    n: int = len(xs)
    if n < 2:
        return 0.0
    mx: float = sum(xs) / n
    my: float = sum(ys) / n
    den: float = sum((x - mx) ** 2 for x in xs)
    if den == 0.0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / den


def since_last_drop(rows: list[dict]) -> list[dict]:
    """마지막으로 용량이 크게 줄어든 측정부터 끝까지. rows 는 measured_on 오름차순."""
    start: int = 0
    for i in range(1, len(rows)):
        if rows[i - 1]["total_bytes"] - rows[i]["total_bytes"] >= DROP_THRESHOLD:
            start = i
    return rows[start:]


def estimate(rows: list[dict], limit_bytes: int) -> dict:
    """쌓인 측정 기록으로 추세를 냅니다. rows 는 measured_on 오름차순,
    각 행에 measured_on(YYYY-MM-DD)·total_bytes 가 있어야 합니다.

    돌려주는 값:
      points      추세에 쓴 측정 수 (2 미만이면 추세 없음)
      latest_on   / latest_bytes / used_pct   가장 최근 측정
      per_week    주당 증가 바이트 (음수면 줄고 있음)
      reach_on    한도 도달 예상일 (증가 중이고 아직 한도 아래일 때만)
      weeks_left  도달까지 남은 주
      trimmed     정리 지점 이후만 썼으면 True
    """
    if not rows:
        return {"points": 0, "latest_on": None, "latest_bytes": 0,
                "used_pct": 0.0, "per_week": None, "reach_on": None,
                "weeks_left": None, "trimmed": False}

    latest: dict = rows[-1]
    latest_bytes: int = int(latest["total_bytes"])
    out: dict = {
        "latest_on": latest["measured_on"],
        "latest_bytes": latest_bytes,
        "used_pct": 100.0 * latest_bytes / limit_bytes if limit_bytes else 0.0,
        "per_week": None,
        "reach_on": None,
        "weeks_left": None,
    }

    used: list[dict] = since_last_drop(rows)
    out["trimmed"] = len(used) < len(rows)
    used = used[-MAX_POINTS:]
    out["points"] = len(used)
    if len(used) < 2:
        return out

    base: date = date.fromisoformat(used[0]["measured_on"])
    xs: list[float] = [float((date.fromisoformat(r["measured_on"]) - base).days) for r in used]
    ys: list[float] = [float(r["total_bytes"]) for r in used]
    per_day: float = _ols_slope(xs, ys)
    out["per_week"] = per_day * 7.0

    remaining: float = limit_bytes - latest_bytes
    if per_day > 0.0 and remaining > 0.0:
        days: float = remaining / per_day
        # 1000주(약 19년)를 넘으면 사실상 안 닿는 것이라 날짜를 내지 않습니다.
        if days / 7.0 <= 1000.0:
            out["weeks_left"] = days / 7.0
            out["reach_on"] = (date.fromisoformat(latest["measured_on"])
                               + timedelta(days=int(days))).isoformat()
    return out


def history(limit: int = MAX_POINTS) -> list[dict]:
    """db_usage 를 measured_on 오름차순으로 읽습니다(최근 limit 개)."""
    rows: list[dict] = supabase_io.select("db_usage", {
        "select": "measured_on,total_bytes,table_bytes,index_bytes,db_bytes,symbols",
        "order": "measured_on.desc",
        "limit": str(limit),
    })
    return sorted(rows, key=lambda r: r["measured_on"])


def report(rows: list[dict], limit_bytes: int) -> None:
    """추세를 사람이 읽을 형태로 출력합니다."""
    est: dict = estimate(rows, limit_bytes)
    if not rows:
        print("DB 용량: 기록 없음 — db/schema_db_usage.sql 적용 후 한 번 실행하세요.")
        return

    print(f"DB 용량: {mb(est['latest_bytes'])} / {mb(limit_bytes)} "
          f"({est['used_pct']:.0f}%) — {est['latest_on']} 기준")

    latest: dict = rows[-1]
    if latest.get("index_bytes") is not None:
        print(f"  본문 {mb(latest['table_bytes'])} · 인덱스 {mb(latest['index_bytes'])}"
              + (f" · 활성종목 {latest['symbols']}개" if latest.get("symbols") else ""))

    if est["points"] < 2:
        print(f"  측정 {est['points']}회 — 추세를 내려면 2회 이상 필요합니다(주 1회 기록).")
        return

    per_week: float = est["per_week"]
    trend: str = f"주당 {'+' if per_week >= 0 else ''}{mb(per_week)}"
    print(f"  추세: {trend} (측정 {est['points']}회"
          + (", 마지막 정리 이후만" if est["trimmed"] else "") + ")")

    if est["reach_on"]:
        print(f"  한도 도달 예상: {est['reach_on']} (약 {est['weeks_left']:.0f}주 뒤)")
    elif per_week <= 0:
        print("  줄어드는 중 — 한도 도달 예상 없음")
    else:
        print("  한도까지 여유가 매우 커서 도달 시점을 내지 않습니다")


def snapshot() -> dict:
    """현재 용량을 재서 db_usage 에 한 줄 기록하고, 기록한 값을 돌려줍니다."""
    rec: dict = supabase_io.record_db_usage()
    print(f"용량 기록: {rec['measured_on']} {mb(rec['total_bytes'])}"
          f" (본문 {mb(rec['table_bytes'])} · 인덱스 {mb(rec['index_bytes'])})")
    return rec


def main(argv: list[str]) -> None:
    limit_mb: int = DEFAULT_LIMIT_MB
    if "--limit" in argv:
        limit_mb = int(argv[argv.index("--limit") + 1])
    limit_bytes: int = limit_mb * MB

    supabase_io.config.require_supabase()
    if "--report" not in argv:
        snapshot()
    report(history(), limit_bytes)


if __name__ == "__main__":
    main(sys.argv[1:])
