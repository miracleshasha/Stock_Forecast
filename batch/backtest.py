"""백테스트 & 가중치 보정.

적재된 일봉으로 각 시점의 기술 그룹 점수(-2~+2)를 재현하고,
H 거래일 뒤 수익률과의 순위상관(IC, Spearman)으로 예측력을 측정합니다.
그룹 가중치를 그리드 탐색해 IC를 높이는 조합을 제안합니다.

주의: 표본(39종목×~270일, 중복구간)이라 정밀 최적화가 아닌 1차 보정입니다.
      기획서대로 더 긴 기간·많은 종목으로 재검증이 필요합니다.

사용법: python backtest.py            (H=10)
        python backtest.py 5 20      (여러 호라이즌)
"""
from __future__ import annotations

import sys

import pandas as pd

import config
import indicators
import scoring
import supabase_io

GROUPS = ["trend", "momentum", "band", "volume"]
WARMUP = 130  # MA120 워밍업


def build_observations(horizons: list[int]) -> pd.DataFrame:
    config.require_supabase()
    symbols = supabase_io.get_active_symbols()
    maxH = max(horizons)
    rows = []
    for sym in symbols:
        ticker = sym["ticker"]
        prices = supabase_io.get_prices(ticker)
        if len(prices) < WARMUP + maxH + 5:
            continue
        df = indicators.compute(prices)
        closes = df["close"].tolist()
        n = len(df)
        for i in range(WARMUP, n - maxH):
            avgs = scoring.technical_group_avgs(df.iloc[: i + 1])
            rec = {"ticker": ticker, **{f"g_{g}": avgs[g] for g in GROUPS}}
            base = closes[i]
            if not base:
                continue
            for h in horizons:
                rec[f"fwd{h}"] = (closes[i + h] - base) / base * 100
            rows.append(rec)
    return pd.DataFrame(rows)


def ic(obs: pd.DataFrame, weights: dict, h: int) -> float:
    # Spearman = 순위값의 Pearson 상관 (scipy 불필요)
    score = sum(obs[f"g_{g}"] * weights[g] for g in GROUPS)
    return score.rank().corr(obs[f"fwd{h}"].rank())


def quintile_table(obs: pd.DataFrame, weights: dict, h: int) -> pd.DataFrame:
    df = obs.copy()
    df["score"] = sum(df[f"g_{g}"] * weights[g] for g in GROUPS)
    df["q"] = pd.qcut(df["score"].rank(method="first"), 5, labels=["Q1(약)", "Q2", "Q3", "Q4", "Q5(강)"])
    return df.groupby("q", observed=True)[f"fwd{h}"].agg(["mean", "count"])


def grid_search(obs: pd.DataFrame, h: int) -> tuple[dict, float]:
    grid = [15, 20, 25, 30]
    best, best_ic = None, -2.0
    for t in grid:
        for m in grid:
            for b in grid:
                for v in grid:
                    w = {"trend": t, "momentum": m, "band": b, "volume": v}
                    val = ic(obs, w, h)
                    if val is not None and val > best_ic:
                        best_ic, best = val, w
    return best, best_ic


def normalize_to_85(w: dict) -> dict:
    s = sum(w.values())
    return {g: round(w[g] / s * 85) for g in GROUPS}


def main(argv):
    horizons = [int(x) for x in argv] if argv else [10]
    horizons = sorted(set(horizons + [5, 10, 20]))
    print(f"관측치 생성 중… (호라이즌 {horizons})")
    obs = build_observations(horizons)
    print(f"관측치 {len(obs):,}개 · 종목 {obs['ticker'].nunique()}개\n")

    # 현재 가중치(기술 부분)
    cur = {g: scoring.WEIGHTS[g] for g in GROUPS}
    print(f"[현재 가중치] {cur}")
    for h in horizons:
        print(f"  IC(H={h:>2}) = {ic(obs, cur, h):+.4f}")

    primary = 10 if 10 in horizons else horizons[0]
    print(f"\n[그리드 탐색 · H={primary} 기준]")
    best, best_ic = grid_search(obs, primary)
    print(f"  최적(원시) {best} → IC {best_ic:+.4f}")
    norm = normalize_to_85(best)
    print(f"  정규화(합 85, 매크로 15 고정) {norm}")
    for h in horizons:
        print(f"  IC(H={h:>2}) = {ic(obs, best, h):+.4f}")

    print(f"\n[5분위 평균 미래수익률 · 최적 가중치 · H={primary}]")
    print(quintile_table(obs, best, primary).to_string())

    print("\n제안: scoring.WEIGHTS 를 아래로 (매크로 15 유지)")
    print(f"  {{'trend': {norm['trend']}, 'momentum': {norm['momentum']}, "
          f"'band': {norm['band']}, 'volume': {norm['volume']}, 'macro': 15}}")


if __name__ == "__main__":
    main(sys.argv[1:])
