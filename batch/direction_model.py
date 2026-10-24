"""종목별 5·10·20거래일 뒤 전망: 방향(오를 확률) + 움직일 범위(80% 구간).

질문 1: "이 종목이 N거래일 뒤 오늘 종가보다 높을까?"  → 확률 P(up).
질문 2: "N거래일 뒤 어디쯤 있을까?"                    → 10%·50%·90% 분위 수익률.

[2026-10 첫 검증 결론 — 정직하게]
  방향: 주식만으로 학습·검증하면 기준 확률(시장 평균 상승 비율) 대비 개선이 국내 +0.04%(±0.06),
        미국 −0.5~−1.1% 로, 기술·모멘텀 피처로 종목별 방향을 맞힌다는 근거가 없습니다.
        → 게이트가 꺼져 지금은 시장·기간별 기준 확률만 보여줍니다. 매주 다시 검증해 통과하면 자동으로 켜집니다.
  범위: 변동성(단기 EWMA + 60일)으로 낸 80% 구간이 검증 기간에 실제로 79~80% 적중하고,
        시장 전체 고정 구간보다 pinball 손실이 8~10% 작습니다. 변동성 5분위별로 분위수를 따로 잡아
        저변동 종목은 구간이 좁게, 고변동 종목은 넓게 나오되 각 분위 적중률이 80% 근처가 되게 했습니다.

[구조] P(up) = 기준 확률(같은 시장에서 N일 뒤 오른 비율, 학습 전 기간) + 종목 차이(기울기)
  - 기준 확률: 시장 전체가 오를지(마켓 타이밍)는 4년 남짓한 데이터로는 학습되지 않았습니다.
    지수 추세·변동성·브레드스를 넣으면 검증 성적이 오히려 2~9% 나빠져(과적합) 뺐습니다.
  - 종목 차이: 같은 날 같은 시장 종목들 사이 순위(0~1)로 바꾼 피처의 로지스틱 회귀(강한 L2).
    순위로 바꾸면 시장 국면 영향이 빠지고 "오늘 이 종목이 다른 종목보다 나은가"만 남습니다.

[피처] 그날 종가까지의 정보만: 1·5·10·20·60일 수익률, 12-1 모멘텀, MA20·60·120 이격, RSI14,
  볼린저 %B, 20·60일 변동성, 52주 고점·저점 거리, 거래량비(20일), 지수 대비 20·60일 초과수익
  학습·검증은 주식만 씁니다. ETF 는 지금 규모 상위로 골라 담아(=그동안 오른 것 위주) 선택편향이
  크고, 넣으면 'ETF면 확률 +10%p' 같은 근거 없는 계수가 생겼습니다. ETF 예측은 같은 계수를 적용합니다.

[검증·게이트] 워크포워드(분기마다 그 전까지로 다시 학습, 라벨 겹침 H일 퍼지). 기준 확률보다
  Brier 가 (2표준오차 넘게 — 매주 6조합을 시험하므로 엄격하게) 좋아야 그 시장·기간의 모델을 켭니다.
  꺼지면 기준 확률만 보여줍니다. 토요일 전량 배치마다 다시 검증합니다.
  비선형 모델(그래디언트 부스팅)도 시험했지만 AUC는 같고 확률 보정이 나빠 쓰지 않았습니다.

주의: 2026-10-24 이전 데이터는 지금 살아있는 종목만이라 생존편향이 있습니다(membership.py 로 이후 보정).

사용법: python direction_model.py --research   (워크포워드 검증 결과만 출력)
        python direction_model.py --train      (검증·학습·저장 + 최신 예측 저장. 토요일 전량 배치가 부름)
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

HORIZONS = (5, 10, 20)
KR = {"KOSPI", "KOSDAQ"}
MARKET_PROXY = {"KR": "069500", "US": "SPY"}
PRICE_CACHE = Path(__file__).parent / "logs" / "pattern_prices_v2.pkl"
MIN_ROWS = 130          # 이보다 짧은 구간은 피처가 안 나와 버립니다
L2 = 1e4                # 강한 축소: 확률이 기준에서 크게 벗어나지 않게(검증상 과신 방지)
GATE_SIGMA = 2.0        # 기준 대비 Brier 개선이 2표준오차를 넘어야 켬
RANGE_Q = (0.1, 0.5, 0.9)
VOL_BUCKETS = 5
WF_START = "2024-01-01"

RAW_FEATURES = [
    "r1", "r5", "r10", "r20", "r60", "mom12_1",
    "ma20_gap", "ma60_gap", "ma120_gap", "rsi14", "bb_pctb",
    "vol20", "vol60", "hi52_gap", "lo52_gap", "log_vol_ratio",
    "ex20", "ex60",
]
FEATURES = [f"xs_{f}" for f in RAW_FEATURES]
HISTORY_COLS = ["ticker", "trade_date"] + [f"{k}{h}" for h in HORIZONS for k in ("p", "lo", "hi")]


# ---------------------------------------------------------------- 피처
def _rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn.replace(0, np.nan))


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    """배치 df(date=YYYYMMDD)와 캐시 df(trade_date=ISO)를 같은 모양으로."""
    df = df.copy()
    if "trade_date" not in df.columns:
        d = df["date"].astype(str)
        df["trade_date"] = d.str[:4] + "-" + d.str[4:6] + "-" + d.str[6:8]
    for k in ("open", "high", "low", "close", "volume"):
        df[k] = pd.to_numeric(df[k], errors="coerce")
    return df.dropna(subset=["close"]).sort_values("trade_date").reset_index(drop=True)


def _segments(df: pd.DataFrame) -> list[pd.DataFrame]:
    """분할·분사처럼 수정주가에 반영 안 된 단절(하루 −65% 이하·+190% 이상, 예: CTVA 2026-10-01 분사)
    에서 끊어 별개 구간으로 다룹니다. 단절을 걸치는 피처·라벨이 생기지 않게."""
    ratio = df["close"] / df["close"].shift(1)
    cuts = list(df.index[(ratio < 0.35) | (ratio > 2.9)])
    out, start = [], 0
    for c in cuts:
        out.append(df.iloc[start:c])
        start = c
    out.append(df.iloc[start:])
    return [s.reset_index(drop=True) for s in out if len(s) >= MIN_ROWS]


def stock_features(df: pd.DataFrame) -> pd.DataFrame:
    c, v = df["close"], df["volume"].astype(float)
    lr = np.log(c).diff()
    f = pd.DataFrame({"trade_date": df["trade_date"], "close": c})
    for n in (1, 5, 10, 20, 60):
        f[f"r{n}"] = c / c.shift(n) - 1
    f["mom12_1"] = c.shift(21) / c.shift(252) - 1
    for n in (20, 60, 120):
        f[f"ma{n}_gap"] = c / c.rolling(n).mean() - 1
    f["rsi14"] = (_rsi(c) - 50) / 50
    ma20, sd20 = c.rolling(20).mean(), c.rolling(20).std(ddof=0)
    f["bb_pctb"] = (c - (ma20 - 2 * sd20)) / (4 * sd20).replace(0, np.nan) - 0.5
    f["vol20"] = lr.rolling(20).std() * np.sqrt(252)
    f["vol60"] = lr.rolling(60).std() * np.sqrt(252)
    f["hi52_gap"] = c / df["high"].rolling(252, min_periods=120).max() - 1
    f["lo52_gap"] = c / df["low"].rolling(252, min_periods=120).min() - 1
    f["log_vol_ratio"] = np.log((v / v.rolling(20).mean()).clip(lower=0.05, upper=20))
    # 범위 예측용 연율 변동성: 최근 충격에 빨리 반응하는 EWMA 와 60일 변동성을 반씩
    ewv = np.sqrt((lr ** 2).ewm(alpha=0.06, min_periods=40).mean()) * np.sqrt(252)
    f["sig"] = 0.5 * ewv + 0.5 * f["vol60"]
    for h in HORIZONS:
        fut = c.shift(-h)
        f[f"y{h}"] = np.where(fut.notna(), (fut > c).astype(float), np.nan)
        f[f"fr{h}"] = fut / c - 1
    return f


def build_panel(data: dict, etf: set[str]) -> pd.DataFrame:
    """data: {ticker: (region, ohlcv df)} → 종목×날짜 패널(피처 + 같은 날 순위 피처 + 라벨)."""
    data = {t: (r, _normalize(df)) for t, (r, df) in data.items() if df is not None and len(df)}
    mret = {}
    for region, t in MARKET_PROXY.items():
        if t in data:
            c = data[t][1].set_index("trade_date")["close"]
            mret[region] = (c / c.shift(20) - 1, c / c.shift(60) - 1)
    parts = []
    for t, (region, df) in data.items():
        for seg in _segments(df):
            f = stock_features(seg)
            f["ticker"], f["region"], f["is_etf"] = t, region, float(t in etf)
            if region in mret:
                f["ex20"] = f["r20"] - f["trade_date"].map(mret[region][0])
                f["ex60"] = f["r60"] - f["trade_date"].map(mret[region][1])
            else:
                f["ex20"] = f["ex60"] = np.nan
            parts.append(f)
    if not parts:
        return pd.DataFrame()
    p = pd.concat(parts, ignore_index=True)
    rk = p.groupby(["region", "trade_date"])[RAW_FEATURES + ["sig"]].rank(pct=True)
    for c in RAW_FEATURES:
        p[f"xs_{c}"] = rk[c] - 0.5
    p["vol_bucket"] = np.minimum((rk["sig"] * VOL_BUCKETS).fillna(-1).astype(int), VOL_BUCKETS - 1)
    return p.sort_values(["trade_date", "ticker"]).reset_index(drop=True)


# ---------------------------------------------------------------- 모델 (넘파이 로지스틱 회귀)
class Logit:
    """표준화 + 클리핑 + L2 로지스틱 회귀(뉴턴법). 계수를 그대로 읽을 수 있어 '왜 이 확률인지'
    (피처별 기여)를 화면에 설명할 수 있습니다."""

    def __init__(self, l2: float = L2):
        self.l2 = l2

    def _z(self, X: np.ndarray) -> np.ndarray:
        return np.nan_to_num(np.clip((X - self.mu) / self.sd, -4, 4))   # 결측은 평균(0)으로

    def fit(self, X: np.ndarray, y: np.ndarray, w: np.ndarray | None = None):
        self.mu = np.nanmean(X, axis=0)
        self.sd = np.nanstd(X, axis=0)
        self.mu[~np.isfinite(self.mu)] = 0.0
        self.sd[~(self.sd > 0)] = 1.0
        Z = np.hstack([np.ones((len(X), 1)), self._z(X)])
        w = np.ones(len(y)) if w is None else w
        beta = np.zeros(Z.shape[1])
        reg = np.full(Z.shape[1], self.l2)
        reg[0] = 0
        n = w.sum()
        for _ in range(25):
            p = 1 / (1 + np.exp(-Z @ beta))
            g = Z.T @ (w * (p - y)) / n + reg * beta / n
            H = (Z * (w * p * (1 - p))[:, None]).T @ Z / n + np.diag(reg / n)
            step = np.linalg.solve(H, g)
            beta -= step
            if np.abs(step).max() < 1e-7:
                break
        self.beta = beta
        return self

    def contrib(self, X: np.ndarray) -> np.ndarray:
        """피처별 로짓 기여(절편 제외)."""
        return self._z(X) * self.beta[1:]

    def predict(self, X: np.ndarray) -> np.ndarray:
        return 1 / (1 + np.exp(-(self.beta[0] + self.contrib(X).sum(axis=1))))

    def to_json(self) -> dict:
        return {"mu": self.mu.round(8).tolist(), "sd": self.sd.round(8).tolist(),
                "beta": self.beta.round(8).tolist()}

    @classmethod
    def from_json(cls, j: dict) -> "Logit":
        m = cls()
        m.mu, m.sd, m.beta = (np.array(j[k], dtype=float) for k in ("mu", "sd", "beta"))
        return m


def _date_weights(d: pd.DataFrame) -> np.ndarray:
    """날짜마다 종목 수가 다르므로 하루 = 같은 무게."""
    w = 1.0 / d.groupby("trade_date")["ticker"].transform("size").to_numpy()
    return w / w.mean()


# ---------------------------------------------------------------- 평가
def auc(y: np.ndarray, p: np.ndarray) -> float:
    n1 = y.sum()
    n0 = len(y) - n1
    if n1 == 0 or n0 == 0:
        return np.nan
    ranks = pd.Series(p).rank().to_numpy()   # 동점은 평균 순위
    return (ranks[y == 1].sum() - n1 * (n1 + 1) / 2) / (n1 * n0)


def _range_z(d: pd.DataFrame, h: int) -> pd.Series:
    """N일 로그수익률을 그 종목 변동성(√H 스케일)으로 나눈 값."""
    return np.log1p(d[f"fr{h}"]) / (d["sig"] * np.sqrt(h / 252))


def fit_range(d: pd.DataFrame, h: int) -> list[list[float]]:
    """변동성 분위별 표준화 수익률의 10·50·90% 분위수. [[q10,q50,q90] × VOL_BUCKETS]"""
    d = d[d[f"fr{h}"].notna() & (d["sig"] > 0) & (d["vol_bucket"] >= 0)]
    z = _range_z(d, h)
    return [np.quantile(z[d["vol_bucket"] == b], RANGE_Q).round(5).tolist() for b in range(VOL_BUCKETS)]


def apply_range(d: pd.DataFrame, h: int, q: list[list[float]]) -> np.ndarray:
    """[n × 3] 수익률(10·50·90%). 변동성이 없으면 NaN."""
    qq = np.array(q)[d["vol_bucket"].clip(lower=0).to_numpy()]
    s = (d["sig"] * np.sqrt(h / 252)).to_numpy()[:, None]
    out = np.expm1(qq * s)
    out[(d["vol_bucket"] < 0).to_numpy() | ~(s[:, 0] > 0)] = np.nan
    return out


def walk_forward_range(panel: pd.DataFrame, h: int, region: str, start: str = WF_START) -> dict:
    """범위 예측 검증: 분기마다 그 전까지로 분위수를 다시 잡고 다음 분기에 적용."""
    d = panel[(panel["region"] == region) & panel[f"fr{h}"].notna() & (panel["sig"] > 0) & (panel["vol_bucket"] >= 0)]
    all_dates = np.sort(panel.loc[panel["region"] == region, "trade_date"].unique())
    pos = {x: i for i, x in enumerate(all_dates)}
    starts = pd.date_range(start, d["trade_date"].max(), freq="QS").strftime("%Y-%m-%d")
    outs = []
    for i, ts in enumerate(starts):
        te = d[(d["trade_date"] >= ts) & (d["trade_date"] < (starts[i + 1] if i + 1 < len(starts) else "9999"))]
        if te.empty or pos[te["trade_date"].min()] - h <= 250:
            continue
        tr = d[d["trade_date"] <= all_dates[pos[te["trade_date"].min()] - h]]
        r = apply_range(te, h, fit_range(tr, h))
        c10, c90 = np.quantile(tr[f"fr{h}"], [0.1, 0.9])   # 비교: 시장 전체 고정 구간
        outs.append(pd.DataFrame({"y": te[f"fr{h}"].to_numpy(), "lo": r[:, 0], "hi": r[:, 2],
                                  "c10": c10, "c90": c90, "b": te["vol_bucket"].to_numpy()}))
    o = pd.concat(outs, ignore_index=True)

    def pin(q, a):
        return np.mean(np.maximum(a * (o["y"] - q), (a - 1) * (o["y"] - q)))
    inside = (o["y"] >= o["lo"]) & (o["y"] <= o["hi"])
    return {"coverage": round(float(inside.mean()), 4),
            "coverage_by_vol": [round(float(inside[o["b"] == b].mean()), 4) for b in range(VOL_BUCKETS)],
            "pinball_skill": round(float(1 - (pin(o["lo"], .1) + pin(o["hi"], .9)) / (pin(o["c10"], .1) + pin(o["c90"], .9))), 4),
            "median_width": round(float((o["hi"] - o["lo"]).median()), 4), "n": int(len(o))}


def walk_forward(panel: pd.DataFrame, h: int, region: str, features: list[str] = FEATURES,
                 start: str = WF_START, make_model=None) -> pd.DataFrame:
    ycol = f"y{h}"
    d = panel[(panel["region"] == region) & panel[ycol].notna() & (panel["is_etf"] == 0)]
    all_dates = np.sort(panel.loc[panel["region"] == region, "trade_date"].unique())
    pos = {x: i for i, x in enumerate(all_dates)}
    test_starts = pd.date_range(start, d["trade_date"].max(), freq="QS").strftime("%Y-%m-%d")
    out = []
    for i, ts in enumerate(test_starts):
        te_end = test_starts[i + 1] if i + 1 < len(test_starts) else "9999"
        te = d[(d["trade_date"] >= ts) & (d["trade_date"] < te_end)]
        if te.empty:
            continue
        # 퍼지: 학습 라벨이 테스트 시작일 이후 가격을 보지 않도록 H거래일 앞에서 자름
        cut_idx = pos[te["trade_date"].min()] - h
        if cut_idx <= 250:
            continue
        tr = d[d["trade_date"] <= all_dates[cut_idx]]
        w = _date_weights(tr)
        m = (make_model() if make_model else Logit()).fit(tr[features].to_numpy(float), tr[ycol].to_numpy(), w)
        te = te.assign(p=m.predict(te[features].to_numpy(float)), base=np.average(tr[ycol], weights=w))
        out.append(te[["trade_date", "ticker", ycol, f"fr{h}", "p", "base"]])
    return pd.concat(out, ignore_index=True)


def report(res: pd.DataFrame, h: int) -> dict:
    ycol = f"y{h}"
    y = res[ycol].to_numpy()
    p, b = res["p"].to_numpy(), res["base"].to_numpy()
    brier, brier0 = np.mean((p - y) ** 2), np.mean((b - y) ** 2)
    # 날짜 단위 Brier 차이의 표준오차(겹침 보정: 유효 표본 = 날짜수/H)
    per_day = res.assign(d=(res["p"] - res[ycol]) ** 2 - (res["base"] - res[ycol]) ** 2).groupby("trade_date")["d"].mean()
    se = per_day.std() / np.sqrt(len(per_day) / h)
    cs = [auc(g[ycol].to_numpy(), g["p"].to_numpy()) for _, g in res.groupby("trade_date") if len(g) >= 30]
    cs = np.array([v for v in cs if v == v])
    bins = pd.cut(res["p"], [0, .45, .48, .5, .52, .55, 1])
    cal = res.groupby(bins, observed=True).agg(n=("p", "size"), p=("p", "mean"), hit=(ycol, "mean"))
    return {
        "n": int(len(res)), "days": int(res["trade_date"].nunique()),
        "from": res["trade_date"].min(), "to": res["trade_date"].max(),
        "up_rate": float(y.mean()), "brier": float(brier), "brier0": float(brier0),
        "skill": float(1 - brier / brier0), "skill_se": float(se / brier0),
        "auc": float(auc(y, p)), "cs_auc": float(cs.mean()) if len(cs) else None,
        "cs_auc_se": float(cs.std() / np.sqrt(len(cs) / h)) if len(cs) else None,
        "cal": [{"p": round(float(r.p), 4), "hit": round(float(r.hit), 4), "n": int(r.n)} for r in cal.itertuples()],
    }


# ---------------------------------------------------------------- 데이터·저장
def _etf_set() -> set[str]:
    import supabase_io
    syms = supabase_io.select("symbols", {"select": "ticker,kind", "is_active": "eq.true"})
    return {s["ticker"] for s in syms if s.get("kind") == "etf"}


def load_cached_panel() -> pd.DataFrame:
    return build_panel(pd.read_pickle(PRICE_CACHE), _etf_set())


def train(panel: pd.DataFrame) -> list[dict]:
    """시장×기간마다 워크포워드 검증 → 게이트 판정 → 전 기간으로 최종 학습. 저장할 행 목록."""
    rows = []
    for region in ("KR", "US"):
        for h in HORIZONS:
            ycol = f"y{h}"
            r = report(walk_forward(panel, h, region), h)
            enabled = r["skill"] - GATE_SIGMA * r["skill_se"] > 0
            d = panel[(panel["region"] == region) & panel[ycol].notna() & (panel["is_etf"] == 0)]
            w = _date_weights(d)
            m = Logit().fit(d[FEATURES].to_numpy(float), d[ycol].to_numpy(), w)
            base = float(np.average(d[ycol], weights=w))
            rr = walk_forward_range(panel, h, region)
            all_region = panel[panel["region"] == region]
            print(f"  [범위 {region} {h}일] 80% 구간 적중 {rr['coverage']:.3f} (변동성 분위별 {rr['coverage_by_vol']})"
                  f" · 고정 구간 대비 {rr['pinball_skill']*100:+.1f}%")
            print(f"  [방향 {region} {h}일] 기준 {base:.3f} · Brier 개선 {r['skill']*100:+.2f}%"
                  f"(±{r['skill_se']*100:.2f}) · 종목 간 AUC {r['cs_auc']:.3f} → {'켬' if enabled else '끔(기준 확률만)'}")
            rows.append({
                "region": region, "horizon": h, "enabled": bool(enabled), "base": round(base, 5),
                "features": FEATURES, "model": m.to_json(), "wf": r,
                "range_q": fit_range(all_region, h), "range_wf": rr,
                "trained_from": d["trade_date"].min(), "trained_to": d["trade_date"].max(),
                "trained_at": datetime.now(timezone.utc).isoformat(),
            })
    return rows


def predict_latest(panel: pd.DataFrame, models: list[dict]) -> list[dict]:
    """시장별 최신 거래일 행마다 5·10·20일 확률과 주요 근거(기여 상위 3개)."""
    out: dict[str, dict] = {}
    for region in ("KR", "US"):
        g = panel[panel["region"] == region]
        if g.empty:
            continue
        last = g[g["trade_date"] == g["trade_date"].max()]
        for mdl in (m for m in models if m["region"] == region):
            h = mdl["horizon"]
            feats = mdl["features"]
            m = Logit.from_json(mdl["model"])
            X = last[feats].to_numpy(float)
            p = m.predict(X) if mdl["enabled"] else np.full(len(last), float(mdl["base"]))
            rng = apply_range(last, h, mdl["range_q"])
            con = m.contrib(X) if mdl["enabled"] else None
            zs = m._z(X) if mdl["enabled"] else None
            for i, t in enumerate(last["ticker"]):
                row = out.setdefault(t, {"ticker": t, "trade_date": last["trade_date"].iloc[i], "drivers": {}})
                row[f"p{h}"] = round(float(p[i]), 4)
                row[f"base{h}"] = round(float(mdl["base"]), 4)
                for k, v in zip(("lo", "mid", "hi"), rng[i]):
                    row[f"{k}{h}"] = round(float(v), 4) if v == v else None
                if con is not None:
                    top = np.argsort(-np.abs(con[i]))[:3]
                    # [피처, 로짓 기여(+면 오를 쪽), 피처 수준(+면 같은 날 종목 중 높은 편)]
                    row["drivers"][str(h)] = [[feats[j].removeprefix("xs_"), round(float(con[i][j]), 4),
                                               int(np.sign(zs[i][j]))]
                                              for j in top if abs(con[i][j]) >= 0.005]
    return list(out.values())


def save(models: list[dict] | None, preds: list[dict]) -> None:
    import supabase_io
    if models:
        supabase_io.upsert("direction_models", models, "region,horizon")
    if preds:
        now = datetime.now(timezone.utc).isoformat()
        supabase_io.upsert("direction_latest", [{**p, "updated_at": now} for p in preds], "ticker")
        supabase_io.upsert("direction_history", [
            {k: p.get(k) for k in HISTORY_COLS} for p in preds
        ], "ticker,trade_date")


def load_models() -> list[dict]:
    import supabase_io
    return supabase_io.select("direction_models", {"select": "region,horizon,enabled,base,features,model,range_q"})


# ---------------------------------------------------------------- 실제 성적(라이브)
def live_track(panel: pd.DataFrame, models: list[dict]) -> None:
    """저장해 둔 예측 중 결과가 나온 것으로 실제 성적을 매겨 models[*]['live'] 에 넣습니다."""
    import supabase_io
    hist = pd.DataFrame(supabase_io.select("direction_history", {"select": ",".join(HISTORY_COLS)}))
    if hist.empty:
        return
    lab = panel[["ticker", "trade_date", "region"] + [f"y{h}" for h in HORIZONS] + [f"fr{h}" for h in HORIZONS]]
    j = hist.merge(lab, on=["ticker", "trade_date"])
    for mdl in models:
        h, region = mdl["horizon"], mdl["region"]
        g = j[(j["region"] == region) & j[f"y{h}"].notna() & j[f"p{h}"].notna()]
        if g.empty:
            continue
        y, p = g[f"y{h}"].to_numpy(), g[f"p{h}"].astype(float).to_numpy()
        b = float(mdl["base"])
        mdl["live"] = {"n": int(len(g)), "days": int(g["trade_date"].nunique()),
                       "from": g["trade_date"].min(), "to": g["trade_date"].max(),
                       "up_rate": float(y.mean()), "brier": float(np.mean((p - y) ** 2)),
                       "brier0": float(np.mean((b - y) ** 2)),
                       "hit": float(np.mean((p > 0.5) == (y == 1))),
                       "range_coverage": float(g[f"fr{h}"].between(g[f"lo{h}"].astype(float), g[f"hi{h}"].astype(float)).mean())}


# ---------------------------------------------------------------- 진입점
def run_weekly() -> None:
    """토요일 전량 배치: pattern_backtest 가 막 새로 받은 가격 캐시로 재검증·재학습·예측."""
    panel = load_cached_panel()
    models = train(panel)
    live_track(panel, models)
    save(models, predict_latest(panel, models))
    print(f"  방향 모델 저장 · 예측 {panel['ticker'].nunique()}종목")


def run_daily(frames: dict) -> int:
    """평일 증분 배치: 이번에 처리한 종목들의 df(지표 계산에 쓴 워밍업+신규)로 최신 예측만 갱신.
    frames: {ticker: (region, df)}. 같은 날 순위를 내야 하므로 시장 전체가 모였을 때만 부르세요."""
    models = load_models()
    if not models:
        return 0
    panel = build_panel(frames, _etf_set())
    preds = predict_latest(panel, models)
    save(None, preds)
    return len(preds)


def research():
    panel = load_cached_panel()
    print(f"패널 {len(panel):,}행 · 종목 {panel['ticker'].nunique()} · {panel['trade_date'].min()}~{panel['trade_date'].max()}")
    for region in ("KR", "US"):
        for h in HORIZONS:
            r = report(walk_forward(panel, h, region), h)
            print(f"[{region} {h}일] {r['n']:,}표본({r['days']}일) 상승비율 {r['up_rate']:.3f} · Brier 개선 "
                  f"{r['skill']*100:+.2f}%(±{r['skill_se']*100:.2f}) · AUC {r['auc']:.3f} · 종목 간 {r['cs_auc']:.3f}"
                  f"(±{r['cs_auc_se']:.3f})")
            for c in r["cal"]:
                print(f"     예측 {c['p']:.3f} → 실제 {c['hit']:.3f} ({c['n']:,})")
            print(f"     범위: {walk_forward_range(panel, h, region)}")


if __name__ == "__main__":
    if "--research" in sys.argv:
        research()
    elif "--train" in sys.argv:
        run_weekly()
