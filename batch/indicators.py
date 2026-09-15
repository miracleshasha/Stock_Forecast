"""지표 계산. OHLCV 시계열 → 지표 시계열(pandas DataFrame).

계산식은 기획서 부록 A를 따릅니다.
"""
from __future__ import annotations

import pandas as pd


def to_frame(candles: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(candles)
    df = df.dropna(subset=["close"]).copy()
    df = df.sort_values("date").reset_index(drop=True)
    for col in ("open", "high", "low", "close"):
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0)
    return df


def _rsi_wilder(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - 100 / (1 + rs)
    rsi = rsi.where(avg_loss != 0, 100.0)
    return rsi


def _wilder(s: pd.Series, period: int) -> pd.Series:
    """Wilder 평활(RSI와 동일 방식). ewm(alpha=1/period)."""
    return s.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def _adx(df: pd.DataFrame, period: int = 14) -> pd.DataFrame:
    """ATR·+DI·-DI·ADX(Wilder). 추세의 '강도'를 재는 값입니다.

    MA 배열은 방향만 알려줄 뿐이라, 횡보장에서 살짝 정배열이어도 강한 추세로
    오인됩니다. ADX가 낮으면 추세 없음으로 걸러내는 필터 역할을 합니다.
    """
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)

    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    atr = _wilder(tr, period)

    up_move = high.diff()
    down_move = -low.diff()
    plus_dm = up_move.where((up_move > down_move) & (up_move > 0), 0.0)
    minus_dm = down_move.where((down_move > up_move) & (down_move > 0), 0.0)

    atr_safe = atr.replace(0, pd.NA)
    plus_di = 100 * _wilder(plus_dm, period) / atr_safe
    minus_di = 100 * _wilder(minus_dm, period) / atr_safe

    di_sum = (plus_di + minus_di).replace(0, pd.NA)
    dx = 100 * (plus_di - minus_di).abs() / di_sum

    return pd.DataFrame({
        "atr14": atr,
        "plus_di14": plus_di,
        "minus_di14": minus_di,
        "adx14": _wilder(dx, period),
    })


def compute(candles: list[dict]) -> pd.DataFrame:
    df = to_frame(candles)
    close = df["close"]

    df["ma20"] = close.rolling(20).mean()
    df["ma60"] = close.rolling(60).mean()
    df["ma120"] = close.rolling(120).mean()

    std20 = close.rolling(20).std(ddof=0)
    df["bb_mid"] = df["ma20"]
    df["bb_upper"] = df["ma20"] + 2 * std20
    df["bb_lower"] = df["ma20"] - 2 * std20
    band = (df["bb_upper"] - df["bb_lower"]).replace(0, pd.NA)
    df["bb_percent_b"] = (close - df["bb_lower"]) / band
    df["bb_width"] = band / df["bb_mid"]

    df["env_upper"] = df["ma20"] * 1.10
    df["env_lower"] = df["ma20"] * 0.90

    df["rsi14"] = _rsi_wilder(close, 14)

    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    df["macd"] = ema12 - ema26
    df["macd_signal"] = df["macd"].ewm(span=9, adjust=False).mean()
    df["macd_hist"] = df["macd"] - df["macd_signal"]

    vol_ma20 = df["volume"].rolling(20).mean().replace(0, pd.NA)
    df["vol_ratio20"] = df["volume"] / vol_ma20

    direction = close.diff().apply(lambda x: 1 if x > 0 else (-1 if x < 0 else 0))
    df["obv"] = (direction * df["volume"]).fillna(0).cumsum()

    # ---- 추세 보강 지표 ----
    # 이 셋은 daily_indicators 에 저장하지 않습니다(스키마 변경 없음).
    # 스코어링과 백테스트는 매번 일봉에서 다시 계산하므로 필요 없습니다.
    df = pd.concat([df, _adx(df)], axis=1)

    # MA20 기울기(10거래일 변화율 %). 정배열이어도 선이 꺾이는 중인 경우를 잡습니다.
    df["ma20_slope10"] = (df["ma20"] / df["ma20"].shift(10) - 1) * 100

    # 52주(250거래일) 고가 대비 위치 %. 추세추종에서 가장 견고한 단일 신호 중 하나.
    high52 = df["high"].rolling(250, min_periods=200).max()
    df["pct_from_52w_high"] = (close / high52 - 1) * 100

    return df


def latest_row(df: pd.DataFrame) -> dict | None:
    if df.empty:
        return None
    return df.iloc[-1].to_dict()


def obv_slope_20(df: pd.DataFrame) -> int:
    """OBV 20일 추세: 상승 +1 / 하락 -1 / 보합 0"""
    if len(df) < 21:
        return 0
    now = df["obv"].iloc[-1]
    past = df["obv"].iloc[-21]
    if pd.isna(now) or pd.isna(past):
        return 0
    if now > past:
        return 1
    if now < past:
        return -1
    return 0
