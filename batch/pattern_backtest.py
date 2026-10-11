"""캔들 패턴 실측: 패턴이 나온 다음 1·5거래일 수익률을 우리 데이터로 잽니다.

결과는 pattern_stats 테이블(패턴 × 국내/미국)에 들어가고, 종목 화면의 단기 신호
카드가 "과거 N번 · 5일 뒤 평균 +x% (전체 평균 +y%)" 형태로 보여줍니다.

비교 기준은 같은 시장의 '아무 날' 평균입니다. 상승장이었다면 아무 날이나 사도
올랐으므로, 패턴의 값어치는 평균 대비 초과분(excess)으로 봐야 합니다.
표준오차는 같은 날 여러 종목이 동시에 같은 패턴을 보이는 상관을 고려해
'날짜별 평균'을 한 표본으로 묶어 계산합니다(보수적).

주의: 현재 유니버스는 지금 살아있는 종목이라 생존편향이 있습니다.

사용법: python pattern_backtest.py          (계산 + DB 저장)
        python pattern_backtest.py --dry    (계산만, 출력)
        python pattern_backtest.py --fresh  (가격 캐시 무시)
        python pattern_backtest.py --backfill (각 종목 최신 판정 행에 short_term 채우기)
"""
from __future__ import annotations

import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

import patterns
import supabase_io

CACHE = Path(__file__).parent / "logs" / "pattern_prices_v2.pkl"  # v2: 볼린저 밴드 컬럼 포함
HORIZONS = (1, 5)
KR = {"KOSPI", "KOSDAQ"}


def load_prices(fresh: bool) -> dict[str, tuple[str, pd.DataFrame]]:
    if CACHE.exists() and not fresh:
        return pd.read_pickle(CACHE)
    syms = supabase_io.get_active_symbols()

    def one(s):
        rows = supabase_io.get_prices(s["ticker"])
        df = pd.DataFrame(rows)
        if df.empty:
            return s["ticker"], None
        for k in ("open", "high", "low", "close", "volume"):
            df[k] = pd.to_numeric(df[k], errors="coerce")
        vol_ma = df["volume"].rolling(20).mean().replace(0, pd.NA)
        df["vol_ratio20"] = df["volume"] / vol_ma
        # 볼린저 밴드: indicators.py 와 같은 정의(20일, 모표준편차 ddof=0, ±2σ)
        ma20 = df["close"].rolling(20).mean()
        std20 = df["close"].rolling(20).std(ddof=0)
        df["bb_upper"] = ma20 + 2 * std20
        df["bb_lower"] = ma20 - 2 * std20
        return s["ticker"], ("KR" if s["market"] in KR else "US", df.reset_index(drop=True))

    with ThreadPoolExecutor(8) as ex:
        data = {t: v for t, v in ex.map(one, syms) if v is not None}
    CACHE.parent.mkdir(exist_ok=True)
    pd.to_pickle(data, CACHE)
    return data


def collect(data) -> pd.DataFrame:
    rows = []
    maxh = max(HORIZONS)
    for ticker, (region, df) in data.items():
        c = df["close"].values
        dates = df["date"].values
        for i in range(len(df) - maxh):
            base = c[i]
            if not base or base != base:
                continue
            fwd = {f"r{h}": (c[i + h] / base - 1) * 100 for h in HORIZONS}
            keys = patterns.detect_at(df, i)
            rows.append({"ticker": ticker, "region": region, "date": dates[i], "keys": keys, **fwd})
    return pd.DataFrame(rows)


def stats(obs: pd.DataFrame) -> pd.DataFrame:
    out = []
    for region, g in obs.groupby("region"):
        base = {h: g[f"r{h}"].mean() for h in HORIZONS}
        base_win5 = (g["r5"] > 0).mean()
        ex = g.explode("keys").dropna(subset=["keys"])
        for key, p in ex.groupby("keys"):
            # 날짜별 평균 초과수익 → 날짜를 독립 표본으로 (같은 날 동시 발생 상관 제거)
            p = p.assign(x5=p["r5"] - base[5])
            daily = p.groupby("date")["x5"].mean()
            n_days = len(daily)
            se5 = daily.std(ddof=1) / n_days ** 0.5 if n_days > 1 else float("nan")
            out.append({
                "pattern": key,
                "region": region,
                "n": int(len(p)),
                "n_days": int(n_days),
                "ret1": round(float(p["r1"].mean()), 3),
                "ret5": round(float(p["r5"].mean()), 3),
                "win5": round(float((p["r5"] > 0).mean()), 3),
                "base_ret1": round(float(base[1]), 3),
                "base_ret5": round(float(base[5]), 3),
                "base_win5": round(float(base_win5), 3),
                "excess5": round(float(p["r5"].mean() - base[5]), 3),
                "se5": round(float(se5), 3) if se5 == se5 else None,
            })
    return pd.DataFrame(out).sort_values(["region", "excess5"], ascending=[True, False])


def backfill_latest(data) -> None:
    """각 종목의 최신 daily_signals 행에 short_term 을 채웁니다(배치를 기다리지 않고 바로 반영)."""
    import requests
    import config

    url = f"{config.SUPABASE_URL}/rest/v1/v_latest_signal"
    latest = requests.get(url, headers=supabase_io._headers(), params={"select": "ticker,trade_date", "limit": "5000"}, timeout=30).json()
    done = skip = 0
    for r in latest:
        item = data.get(r["ticker"])
        if not item:
            skip += 1
            continue
        _, df = item
        ymd = r["trade_date"].replace("-", "")
        idx = df.index[df["date"] == ymd]
        if len(idx) == 0:
            skip += 1
            continue
        st = patterns.summarize(patterns.detect_at(df, int(idx[-1])))
        supabase_io.patch("daily_signals", {"ticker": r["ticker"], "trade_date": r["trade_date"]}, {"short_term": st})
        done += 1
    print(f"short_term 채움 {done} · 건너뜀 {skip}")


def run(fresh: bool = True, save: bool = True) -> None:
    """배치(토요일 전량)에서 부르는 진입점."""
    main((["--fresh"] if fresh else []) + ([] if save else ["--dry"]))


def main(argv):
    data = load_prices("--fresh" in argv)
    print(f"종목 {len(data)}개 로드")
    if "--backfill" in argv:
        backfill_latest(data)
        return
    obs = collect(data)
    print(f"관측 {len(obs):,}건 · 기간 {obs['date'].min()} ~ {obs['date'].max()}")
    st = stats(obs)
    with pd.option_context("display.max_rows", 200, "display.width", 200):
        print(st[["region", "pattern", "n", "n_days", "ret5", "base_ret5", "excess5", "se5", "win5", "base_win5"]]
              .to_string(index=False))
    if "--dry" in argv:
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = [{**r, "computed_at": now, "period_from": str(obs["date"].min()), "period_to": str(obs["date"].max())}
            for r in st.to_dict("records")]
    supabase_io.upsert("pattern_stats", rows, "pattern,region")
    print(f"pattern_stats {len(rows)}행 저장")


if __name__ == "__main__":
    main(sys.argv[1:])
