"""백테스트 & 가중치 보정.

적재된 일봉으로 각 시점의 기술 그룹 점수(-2~+2)를 재현하고,
H 거래일 뒤 수익률과의 순위상관(IC, Spearman)으로 예측력을 측정합니다.
그룹 가중치를 그리드 탐색해 IC를 높이는 조합을 제안합니다.

주의: 한 시장 안에서도 종목들이 같이 움직이고 미래수익률 구간이 겹치므로,
      가중치는 앞/뒤 기간 분할 검증(4번 절)을 통과할 때만 반영하세요.

매크로는 전 종목이 같은 값을 받는 시계열이라 위 방식(횡단면 IC)으로는 예측력을
측정할 수 없습니다. --macro 모드가 FRED 장기 시계열로 지수 수익률을 상대한
'시장 타이밍' 관점에서 따로 검증합니다.

사용법: python backtest.py            (기술 그룹 횡단면 IC, H=10)
        python backtest.py 5 20      (여러 호라이즌)
        python backtest.py --macro   (매크로 시장 타이밍 검증)
        python backtest.py --fresh   (관측치 캐시 무시하고 DB에서 다시 생성)
"""
from __future__ import annotations

import os
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import pandas as pd

import config
import indicators
import scoring
import supabase_io

GROUPS = ["trend", "momentum", "band", "volume"]
WARMUP = 130  # MA120 워밍업


def _symbol_observations(args: tuple[str, str, list[int]]) -> list[dict]:
    """한 종목의 관측치. 추세 그룹은 TREND_EXTRA 꺼짐/켜짐 두 값을 함께 냅니다
    (g_trend / g_trend_x) — A/B를 같은 표본에서 비교하기 위해서입니다."""
    ticker, market, horizons = args
    maxH = max(horizons)
    prices = supabase_io.get_prices(ticker)
    if len(prices) < WARMUP + maxH + 5:
        return []
    df = indicators.compute(prices)
    closes = df["close"].tolist()
    dates = df["date"].tolist()
    rows = []
    for i in range(WARMUP, len(df) - maxH):
        base = closes[i]
        if not base:
            continue
        window = df.iloc[: i + 1]
        config.TREND_EXTRA = False
        avgs = scoring.technical_group_avgs(window)
        config.TREND_EXTRA = True
        trend_x = scoring.technical_group_avgs(window)["trend"]
        rec = {"ticker": ticker, "market": market, "date": dates[i],
               **{f"g_{g}": avgs[g] for g in GROUPS}, "g_trend_x": trend_x}
        for h in horizons:
            rec[f"fwd{h}"] = (closes[i + h] - base) / base * 100
        rows.append(rec)
    return rows


CACHE = Path(__file__).parent / "logs" / "backtest_obs.pkl"


def build_observations(horizons: list[int], use_cache: bool = True) -> pd.DataFrame:
    """관측치 생성. 종목 수×일수가 커서(670×~850) 프로세스 병렬로 돌리고,
    결과를 logs/backtest_obs.pkl 에 캐시합니다(--fresh 로 무시)."""
    if use_cache and CACHE.exists():
        obs = pd.read_pickle(CACHE)
        if all(f"fwd{h}" in obs for h in horizons):
            print(f"(캐시 사용: {CACHE.name} — 새로 만들려면 --fresh)")
            return obs
    config.require_supabase()
    symbols = supabase_io.get_active_symbols()
    jobs = [(s["ticker"], s["market"], horizons) for s in symbols]
    rows: list[dict] = []
    with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as ex:
        for part in ex.map(_symbol_observations, jobs, chunksize=4):
            rows.extend(part)
    obs = pd.DataFrame(rows)
    CACHE.parent.mkdir(exist_ok=True)
    obs.to_pickle(CACHE)
    return obs


MIN_PER_DATE = 10  # 횡단면 상관을 낼 최소 종목 수


def _score(obs: pd.DataFrame, weights: dict) -> pd.Series:
    return sum(obs[f"g_{g}"] * w for g, w in weights.items())


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


def _region(obs: pd.DataFrame) -> pd.Series:
    return obs["market"].map(lambda m: "KR" if m in ("KOSPI", "KOSDAQ") else "US")


def _cross_sections(obs: pd.DataFrame):
    """횡단면 단위 = (시장, 날짜). 한국과 미국을 같은 줄에 세우면 두 시장이
    그 기간 달리 움직인 효과가 '종목 고르기' 예측력으로 섞여 들어갑니다."""
    return obs.groupby([_region(obs), "date"])


def daily_ics(obs: pd.DataFrame, weights: dict, h: int) -> pd.Series:
    """(시장, 날짜)별 횡단면 순위상관 시계열."""
    # 그리드 탐색이 수백 번 부르므로 그룹 루프 대신 벡터 연산으로:
    # 그룹 내 순위 → 그룹 평균 제거 → 공분산/표준편차 합으로 피어슨(=스피어만)
    keys = [_region(obs), obs["date"]]
    fwd = obs[f"fwd{h}"]
    ok = fwd.notna()
    d = pd.DataFrame({"s": _score(obs, weights), "f": fwd})[ok]
    keys = [k[ok] for k in keys]
    g = d.groupby(keys)
    ra = g["s"].rank()
    rb = g["f"].rank()
    a = ra - ra.groupby(keys).transform("mean")
    b = rb - rb.groupby(keys).transform("mean")
    t = pd.DataFrame({"ab": a * b, "aa": a * a, "bb": b * b, "n": 1}).groupby(keys).sum()
    t = t[(t["n"] >= MIN_PER_DATE) & (t["aa"] > 0) & (t["bb"] > 0)]
    return t["ab"] / (t["aa"] * t["bb"]) ** 0.5


def ic_stats(obs: pd.DataFrame, weights: dict, h: int) -> tuple[float, float, int]:
    """(평균 IC, 표준오차, 횡단면 수).

    H일 미래수익률은 이웃 날짜끼리 H-1일이 겹쳐 서로 독립이 아닙니다.
    그래서 표준오차는 유효 표본을 횡단면 수/H 로 잡아 계산합니다
    (예전 sd/sqrt(n)은 H=10에서 오차를 ~3배 작게 봐 '유의'를 남발했습니다).
    """
    s = daily_ics(obs, weights, h)
    if s.empty:
        return 0.0, 0.0, 0
    # 같은 날의 KR/US 횡단면도 서로 얽혀 있으므로 날짜 수 기준(보수적)
    n_dates = len({d for _, d in s.index})
    n_eff = max(n_dates / h, 1.0)
    return float(s.mean()), float(s.std() / n_eff ** 0.5), len(s)


def quintile_table(obs: pd.DataFrame, weights: dict, h: int) -> pd.DataFrame:
    """(시장, 날짜)별로 5분위를 나눈 뒤 집계. 섞어 나누면 '언제'와 '무엇'이 뒤섞입니다."""
    df = obs.assign(score=_score(obs, weights))
    parts = []
    for _, g in _cross_sections(df):
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


def _fmt(obs: pd.DataFrame, w: dict, h: int) -> str:
    m, se, n = ic_stats(obs, w, h)
    sig = "유의" if n and abs(m) > 2 * se else "–"
    return f"{m:+.4f} ± {se:.4f} {sig:<4}"


def _split_by_date(obs: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """날짜 기준 앞/뒤 절반. 경계 근처는 미래수익률 구간이 겹치므로
    최대 호라이즌만큼 비워(embargo) 앞 구간 정보가 뒤로 새지 않게 합니다."""
    dates = sorted(obs["date"].unique())
    mid = len(dates) // 2
    gap = max(int(c[3:]) for c in obs.columns if c.startswith("fwd"))
    train = obs[obs["date"] < dates[mid - gap]]
    test = obs[obs["date"] >= dates[mid]]
    return train, test


def _attach_vix(obs: pd.DataFrame) -> pd.DataFrame:
    """각 관측일 직전(당일 제외) VIX. 국내 18:30 배치가 보는 VIX는 전날 미국장
    값이고, 당일 값을 쓰면 미세한 선반영이 생기므로 보수적으로 직전값."""
    import fred

    vix = pd.DataFrame(fred.fetch_series("VIXCLS", 3000), columns=["d", "vix"])
    vix["d"] = pd.to_datetime(vix["d"])
    o = obs.assign(_d=pd.to_datetime(obs["date"], format="%Y%m%d"))
    o = o.sort_values("_d")
    o = pd.merge_asof(o, vix.sort_values("d"), left_on="_d", right_on="d",
                      allow_exact_matches=False)
    return o.drop(columns=["_d", "d"])


def main(argv):
    if "--macro" in argv:
        macro_timing([5, 10, 20, 60])
        return

    fresh = "--fresh" in argv
    argv = [a for a in argv if not a.startswith("--")]
    horizons = [int(x) for x in argv] if argv else [10]
    horizons = sorted(set(horizons + [5, 10, 20]))
    print(f"관측치 생성 중… (호라이즌 {horizons})")
    obs = build_observations(horizons, use_cache=not fresh)
    obs = obs.dropna(subset=[f"g_{g}" for g in GROUPS])
    rg = _region(obs)
    print(f"관측치 {len(obs):,}개 · 종목 {obs['ticker'].nunique()}개 "
          f"(KR {obs[rg == 'KR']['ticker'].nunique()} / US {obs[rg == 'US']['ticker'].nunique()}) · "
          f"기간 {obs['date'].min()} ~ {obs['date'].max()}")
    print("표준오차는 겹치는 수익률 구간을 반영(유효표본=날짜수/H). '유의' = |IC| > 2SE\n")

    cur = {g: scoring.WEIGHTS[g] for g in GROUPS}
    primary = 10 if 10 in horizons else horizons[0]

    print(f"[1. 현재 가중치 {cur}]")
    for h in horizons:
        print(f"  H={h:>2}  전체 {_fmt(obs, cur, h)}   "
              f"KR {_fmt(obs[rg == 'KR'], cur, h)}   US {_fmt(obs[rg == 'US'], cur, h)}")

    print(f"\n[2. 그룹 단독 IC · H={primary}]  (가중치가 아니라 지표 자체가 맞는지)")
    for g in GROUPS + ["trend_x"]:
        o = obs.assign(g_trend=obs["g_trend_x"]) if g == "trend_x" else obs
        gg = "trend" if g == "trend_x" else g
        w = {k: (1 if k == gg else 0) for k in GROUPS}
        label = "trend(+보강)" if g == "trend_x" else g
        print(f"  {label:<12} 전체 {_fmt(o, w, primary)}   "
              f"KR {_fmt(o[rg == 'KR'], w, primary)}   US {_fmt(o[rg == 'US'], w, primary)}")

    print(f"\n[3. TREND_EXTRA A/B · 현재 가중치]")
    obs_x = obs.assign(g_trend=obs["g_trend_x"])
    for h in horizons:
        a = ic_stats(obs, cur, h)[0]
        m, se, _ = ic_stats(obs_x, cur, h)
        diff = daily_ics(obs_x, cur, h) - daily_ics(obs, cur, h)
        n_eff = max(len({d for _, d in diff.index}) / h, 1.0)
        dse = diff.std() / n_eff ** 0.5
        verdict = "유의" if abs(diff.mean()) > 2 * dse else "차이 없음"
        print(f"  H={h:>2}  끔 {a:+.4f} → 켬 {m:+.4f}   차이 {diff.mean():+.4f} ± {dse:.4f} ({verdict})")

    print(f"\n[4. 기간 분할 검증 · 앞 절반에서 그리드 → 뒤 절반에서 채점 · H={primary}]")
    train, test = _split_by_date(obs)
    print(f"  학습 {train['date'].min()}~{train['date'].max()} / "
          f"검증 {test['date'].min()}~{test['date'].max()}")
    best, best_ic = grid_search(train, primary)
    eq = {g: 25 for g in GROUPS}
    print(f"  학습 최적 {best}  (학습 IC {best_ic:+.4f})")
    for name, w in [("학습 최적", best), ("현재", cur), ("균등", eq)]:
        print(f"  {name:<6} 학습 {_fmt(train, w, primary)}  검증 {_fmt(test, w, primary)}")

    print(f"\n[5. 전체 기간 그리드 · H={primary}] (참고용 — in-sample)")
    best_all, best_all_ic = grid_search(obs, primary)
    print(f"  최적 {best_all} → 정규화 {normalize_to_100(best_all)}  IC {best_all_ic:+.4f}")

    print(f"\n[6. 5분위 평균 미래수익률 · 현재 가중치 · H={primary}]")
    print(quintile_table(obs, cur, primary).to_string())

    print(f"\n[7. VIX 국면별 IC · 현재 가중치]  (STRESS_DAMP 근거 재확인)")
    try:
        ov = _attach_vix(obs)
        bins = [0, 16, 20, 25, 999]
        ov["regime"] = pd.cut(ov["vix"], bins, right=False,
                              labels=["<16", "16-20", "20-25", "≥25"])
        for h in [5, primary, 20]:
            parts = []
            for lab, sub in ov.groupby("regime", observed=True):
                m, se, n = ic_stats(sub, cur, h)
                parts.append(f"{lab}: {m:+.3f}±{se:.3f} (n{n})")
            print(f"  H={h:>2}  " + "   ".join(parts))
    except Exception as e:  # FRED 장애 시에도 나머지 결과는 살립니다
        print(f"  VIX 조회 실패: {e}")


if __name__ == "__main__":
    main(sys.argv[1:])
