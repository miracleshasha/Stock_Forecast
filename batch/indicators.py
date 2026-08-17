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
