"""장기 모멘텀 · 단기 되돌림 팩터 검증.

backtest.py 가 현재 기술 점수(추세/모멘텀/밴드/거래량)의 예측력이 0과 구별되지
않는다는 걸 보였습니다. 여기서는 학계에서 종목 간 비교 예측력이 알려진 가격
팩터를 같은 틀(시장·날짜별 횡단면 IC, 중첩 보정 표준오차)로 잽니다.

  mom12_1  12개월 수익률, 최근 1개월 제외 (장기 모멘텀)
  mom6_1   6개월 수익률, 최근 1개월 제외
  rev1w    최근 1주 수익률의 음수 (단기 되돌림)
  rev1m    최근 1개월 수익률의 음수

관측치의 미래수익률·기술 점수는 backtest.py 캐시(logs/backtest_obs.pkl)를
재사용합니다. 먼저 `python backtest.py` 를 한 번 돌려 두세요.

사용법: python factor_test.py
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pandas as pd

import backtest as bt
import config
import scoring
import supabase_io

PRICE_CACHE = Path(__file__).parent / "logs" / "factor_prices.pkl"
FACTORS = ["mom12_1", "mom6_1", "rev1w", "rev1m"]
LABEL = {"mom12_1": "12-1개월 모멘텀", "mom6_1": "6-1개월 모멘텀",
         "rev1w": "1주 되돌림", "rev1m": "1개월 되돌림", "tech": "현재 기술점수"}


def _load_closes() -> pd.DataFrame:
    if PRICE_CACHE.exists():
        return pd.read_pickle(PRICE_CACHE)
    config.require_supabase()
    tickers = [s["ticker"] for s in supabase_io.get_active_symbols()]

    def one(t):
        rows = supabase_io.get_prices(t)
        return pd.DataFrame({"ticker": t, "date": [r["date"] for r in rows],
                             "close": [r["close"] for r in rows]})

    with ThreadPoolExecutor(max_workers=8) as ex:
        df = pd.concat(ex.map(one, tickers), ignore_index=True)
    df.to_pickle(PRICE_CACHE)
    return df


def compute_factors(closes: pd.DataFrame) -> pd.DataFrame:
    out = []
    for t, g in closes.sort_values("date").groupby("ticker"):
        c = g["close"].astype(float).reset_index(drop=True)
        f = pd.DataFrame({"ticker": t, "date": g["date"].values})
        f["g_mom12_1"] = c.shift(21) / c.shift(252) - 1
        f["g_mom6_1"] = c.shift(21) / c.shift(126) - 1
        f["g_rev1w"] = -(c / c.shift(5) - 1)
        f["g_rev1m"] = -(c / c.shift(21) - 1)
        out.append(f)
    return pd.concat(out, ignore_index=True)


def _rank_pct(obs: pd.DataFrame, col: str) -> pd.Series:
    """시장·날짜 안 백분위(0~1). 단위가 다른 점수를 섞기 위한 정규화."""
    return obs.groupby([bt._region(obs), obs["date"]])[col].rank(pct=True)


def _by_year(obs: pd.DataFrame, w: dict, h: int) -> str:
    s = bt.daily_ics(obs, w, h)
    yr = pd.Series(s.values, index=[d[:4] for _, d in s.index])
    return "  ".join(f"{y}:{v:+.3f}" for y, v in yr.groupby(level=0).mean().items())


def main():
    obs = pd.read_pickle(bt.CACHE)
    obs = obs.dropna(subset=[f"g_{g}" for g in bt.GROUPS])
    cur = {g: scoring.WEIGHTS[g] for g in bt.GROUPS}
    obs["g_tech"] = bt._score(obs, cur)

    fac = compute_factors(_load_closes())
    obs = obs.merge(fac, on=["ticker", "date"], how="inner")
    # 모든 팩터가 정의된 같은 표본에서 비교 (12개월 워밍업 이후)
    obs = obs.dropna(subset=[f"g_{f}" for f in FACTORS]).reset_index(drop=True)
    for c in ["tech"] + FACTORS:
        obs[f"g_r_{c}"] = _rank_pct(obs, f"g_{c}")

    rg = bt._region(obs)
    kr, us = obs[rg == "KR"], obs[rg == "US"]
    print(f"공통 표본 {len(obs):,}개 · 종목 {obs['ticker'].nunique()} · "
          f"기간 {obs['date'].min()} ~ {obs['date'].max()}")
    print("IC ± 표준오차(중첩 보정). '유의' = |IC| > 2SE\n")

    print("[1. 단독 IC]")
    for h in [5, 10, 20]:
        print(f" H={h}")
        for c in ["tech"] + FACTORS:
            w = {c: 1}
            print(f"  {LABEL[c]:<12} 전체 {bt._fmt(obs, w, h)}  "
                  f"KR {bt._fmt(kr, w, h)}  US {bt._fmt(us, w, h)}")

    h = 20
    print(f"\n[2. 연도별 평균 IC · H={h}]  (부호가 해마다 유지되는지)")
    for c in ["tech"] + FACTORS:
        print(f"  {LABEL[c]:<12} {_by_year(obs, {c: 1}, h)}")

    print(f"\n[3. 기간 분할 · 앞/뒤 절반 · H={h}]")
    train, test = bt._split_by_date(obs)
    print(f"  앞 {train['date'].min()}~{train['date'].max()} / 뒤 {test['date'].min()}~{test['date'].max()}")
    for c in ["tech"] + FACTORS:
        w = {c: 1}
        print(f"  {LABEL[c]:<12} 앞 {bt._fmt(train, w, h)}  뒤 {bt._fmt(test, w, h)}")

    print(f"\n[4. 조합 (시장·날짜 내 백분위 합) · H={h}]")
    combos = {
        "기술점수 + 12-1모멘텀": {"r_tech": 1, "r_mom12_1": 1},
        "12-1모멘텀 + 1개월되돌림": {"r_mom12_1": 1, "r_rev1m": 1},
        "12-1모멘텀 + 1주되돌림": {"r_mom12_1": 1, "r_rev1w": 1},
        "기술 + 12-1모멘텀 + 1개월되돌림": {"r_tech": 1, "r_mom12_1": 1, "r_rev1m": 1},
    }
    for name, w in combos.items():
        print(f"  {name:<22} 전체 {bt._fmt(obs, w, h)}  앞 {bt._fmt(train, w, h)}  뒤 {bt._fmt(test, w, h)}")

    print(f"\n[5. 5분위 평균 {h}일 수익률(%) · 시장·날짜별 분위]")
    tbl = {LABEL[c]: bt.quintile_table(obs, {c: 1}, h)["mean"] for c in ["tech"] + FACTORS}
    print(pd.DataFrame(tbl).round(2).to_string())


if __name__ == "__main__":
    main()
