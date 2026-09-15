"""백테스트 & 가중치 보정.

적재된 일봉으로 각 시점의 기술 그룹 점수(-2~+2)를 재현하고,
H 거래일 뒤 수익률과의 순위상관(IC, Spearman)으로 예측력을 측정합니다.
그룹 가중치를 그리드 탐색해 IC를 높이는 조합을 제안합니다.

주의: 표본(39종목×~270일, 중복구간)이라 정밀 최적화가 아닌 1차 보정입니다.
      기획서대로 더 긴 기간·많은 종목으로 재검증이 필요합니다.

매크로는 전 종목이 같은 값을 받는 시계열이라 위 방식(횡단면 IC)으로는 예측력을
측정할 수 없습니다. --macro 모드가 FRED 장기 시계열로 지수 수익률을 상대한
'시장 타이밍' 관점에서 따로 검증합니다.

사용법: python backtest.py            (기술 그룹 횡단면 IC, H=10)
        python backtest.py 5 20      (여러 호라이즌)
        python backtest.py --macro   (매크로 시장 타이밍 검증)
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
        dates = df["date"].tolist()
        for i in range(WARMUP, n - maxH):
            avgs = scoring.technical_group_avgs(df.iloc[: i + 1])
            rec = {"ticker": ticker, "date": dates[i],
                   **{f"g_{g}": avgs[g] for g in GROUPS}}
            base = closes[i]
            if not base:
                continue
            for h in horizons:
                rec[f"fwd{h}"] = (closes[i + h] - base) / base * 100
            rows.append(rec)
    return pd.DataFrame(rows)


MIN_PER_DATE = 10  # 횡단면 상관을 낼 최소 종목 수


def _score(obs: pd.DataFrame, weights: dict) -> pd.Series:
    return sum(obs[f"g_{g}"] * weights[g] for g in GROUPS)


def pooled_ic(obs: pd.DataFrame, weights: dict, h: int) -> float:
    """모든 (종목, 날짜) 관측치를 한데 섞어 낸 순위상관.

    주의: 이 값은 시계열 변동과 횡단면 변동이 섞여 있어 '종목 고르기' 예측력을
    과대/과소 평가합니다. 비교용으로만 남겨둡니다. 판단은 ic()로 하세요.
    """
    return _score(obs, weights).rank().corr(obs[f"fwd{h}"].rank())


def ic(obs: pd.DataFrame, weights: dict, h: int) -> float:
    """표준 IC — 날짜별 횡단면 순위상관의 평균.

    같은 날짜 안에서 종목들을 줄 세웠을 때 순서가 맞는지를 봅니다. 이것이
    '어떤 종목이 더 오를까'에 대응하는 측정입니다. 날짜를 섞으면 시장 전체가
    오르내린 효과가 끼어들어 값이 왜곡됩니다.
    """
    return ic_stats(obs, weights, h)[0]


def ic_stats(obs: pd.DataFrame, weights: dict, h: int) -> tuple[float, float, int]:
    """(평균 IC, 날짜간 표준편차, 날짜 수). 표준오차 = 표준편차/sqrt(날짜수)."""
    d = obs.assign(_s=_score(obs, weights))
    vals = []
    for _, g in d.groupby("date"):
        if len(g) < MIN_PER_DATE:
            continue
        c = g["_s"].rank().corr(g[f"fwd{h}"].rank())
        if pd.notna(c):
            vals.append(c)
    if not vals:
        return 0.0, 0.0, 0
    s = pd.Series(vals)
    return float(s.mean()), float(s.std()), len(s)


def quintile_table(obs: pd.DataFrame, weights: dict, h: int) -> pd.DataFrame:
    """날짜별로 5분위를 나눈 뒤 집계. 날짜를 섞어 나누면 '언제'와 '무엇'이 뒤섞입니다."""
    df = obs.assign(score=_score(obs, weights))
    parts = []
    for _, g in df.groupby("date"):
        if len(g) < MIN_PER_DATE:
            continue
        g = g.copy()
        g["q"] = pd.qcut(g["score"].rank(method="first"), 5,
                         labels=["Q1(약)", "Q2", "Q3", "Q4", "Q5(강)"])
        parts.append(g)
    if not parts:
        return pd.DataFrame()
    allg = pd.concat(parts)
    return allg.groupby("q", observed=True)[f"fwd{h}"].agg(["mean", "count"])


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


def normalize_to_100(w: dict) -> dict:
    """매크로가 방향에서 빠졌으므로 기술 4그룹이 100을 나눠 갖습니다."""
    s = sum(w.values())
    return {g: round(w[g] / s * 100) for g in GROUPS}


# ------------------------------------------------------------------ 매크로 검증
def _macro_history(lookback: int = 2000) -> pd.DataFrame:
    """FRED로 매크로 + S&P500 일별 시계열을 만듭니다.

    daily_macro 테이블은 배치 시작(2026-08) 이후분뿐이라 표본이 20여 개에
    불과합니다. 검증에는 FRED 원본을 직접 받아 수년치를 씁니다.
    """
    import fred

    series = {
        "vix": "VIXCLS",
        "us10y": "DGS10",
        "usdkrw": "DEXKOUS",
        "spx": "SP500",
    }
    frames = []
    for name, sid in series.items():
        s = pd.Series(dict(fred.fetch_series(sid, lookback)), name=name)
        frames.append(s)
    df = pd.concat(frames, axis=1).sort_index()
    df = df.dropna(subset=["spx", "vix"])
    # 스코어링과 동일하게 5영업일 변화량을 씁니다
    df["_us10y_chg"] = df["us10y"] - df["us10y"].shift(5)
    df["_usdkrw_chg"] = df["usdkrw"] - df["usdkrw"].shift(5)
    return df


def macro_timing(horizons: list[int], lookback: int = 2000):
    """매크로 시장공통 점수 → 지수(S&P500) 미래수익률 예측력."""
    df = _macro_history(lookback)
    print(f"매크로 표본 {len(df):,}일 ({df.index[0]} ~ {df.index[-1]})\n")

    scores = []
    for _, row in df.iterrows():
        items = scoring.macro_market_items(row.to_dict(), "USD")
        scores.append(scoring.group_avg(items))
    df = df.assign(macro_score=scores)

    maxH = max(horizons)
    for h in horizons:
        df[f"fwd{h}"] = df["spx"].shift(-h) / df["spx"] * 100 - 100
    df = df.iloc[:-maxH]

    print(f"{'호라이즌':<10}{'IC(순위상관)':>16}{'표본':>10}")
    for h in horizons:
        sub = df.dropna(subset=["macro_score", f"fwd{h}"])
        val = sub["macro_score"].rank().corr(sub[f"fwd{h}"].rank())
        print(f"H={h:<8}{val:>+16.4f}{len(sub):>10,}")

    h = horizons[len(horizons) // 2]
    print(f"\n[매크로 점수 구간별 지수 평균 미래수익률 · H={h}]")
    sub = df.dropna(subset=["macro_score", f"fwd{h}"]).copy()
    sub["bucket"] = pd.cut(sub["macro_score"], [-2.01, -1, -0.34, 0.34, 1, 2.01],
                           labels=["매우부정", "부정", "중립", "긍정", "매우긍정"])
    tbl = sub.groupby("bucket", observed=True)[f"fwd{h}"].agg(["mean", "count"])
    print(tbl.to_string())

    print("\n해석: IC가 0 근처면 현재 매크로 항목/임계값은 시장 방향을 예측하지")
    print("      못한다는 뜻입니다. WEIGHTS['macro']=15 는 기획서 추정치이며")
    print("      아직 이 검증을 통과한 적이 없습니다.")


def main(argv):
    if "--macro" in argv:
        macro_timing([5, 10, 20, 60])
        return

    horizons = [int(x) for x in argv] if argv else [10]
    horizons = sorted(set(horizons + [5, 10, 20]))
    print(f"관측치 생성 중… (호라이즌 {horizons})")
    obs = build_observations(horizons)
    print(f"관측치 {len(obs):,}개 · 종목 {obs['ticker'].nunique()}개\n")

    # 현재 가중치(기술 부분)
    cur = {g: scoring.WEIGHTS[g] for g in GROUPS}
    print(f"[현재 가중치] {cur}")
    for h in horizons:
        m, sd, nd = ic_stats(obs, cur, h)
        se = sd / (nd ** 0.5) if nd else 0.0
        sig = "유의" if nd and abs(m) > 2 * se else "유의하지 않음"
        print(f"  IC(H={h:>2}) = {m:+.4f} ± {se:.4f} (날짜 {nd}, {sig})"
              f"   [참고: 풀링 {pooled_ic(obs, cur, h):+.4f}]")

    primary = 10 if 10 in horizons else horizons[0]
    print(f"\n[그리드 탐색 · H={primary} 기준]")
    best, best_ic = grid_search(obs, primary)
    print(f"  최적(원시) {best} → IC {best_ic:+.4f}")
    norm = normalize_to_100(best)
    print(f"  정규화(합 100) {norm}")
    for h in horizons:
        print(f"  IC(H={h:>2}) = {ic(obs, best, h):+.4f}")

    print(f"\n[5분위 평균 미래수익률 · 최적 가중치 · H={primary}]")
    print(quintile_table(obs, best, primary).to_string())

    print("\n제안: scoring.WEIGHTS 를 아래로")
    print(f"  {{'trend': {norm['trend']}, 'momentum': {norm['momentum']}, "
          f"'band': {norm['band']}, 'volume': {norm['volume']}}}")


if __name__ == "__main__":
    main(sys.argv[1:])
