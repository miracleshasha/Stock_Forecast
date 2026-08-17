"""스코어링 엔진.

각 지표를 -2~+2로 점수화 → 그룹 가중합 → -100~+100 정규화 → 구간 판정.
요약 문장과 근거 태그(pos:/neg:/neu: 접두)도 함께 생성합니다.

주의: 가중치·임계값은 기획서 5.1의 초기 제안값입니다.
오픈 전 백테스트로 보정이 필요합니다. (확인이 필요합니다)
"""
from __future__ import annotations

import math

import pandas as pd

# 가중치: backtest.py 1차 보정 결과 (H=10 IC 최적, 2026-08 데이터).
# 주의: 상승장 표본의 in-sample 결과라 추세 비중이 높게 잡혔습니다.
#       더 긴 기간·out-of-sample 재검증 필요. 원안은 25/25/20/15/15.
WEIGHTS = {"trend": 34, "momentum": 17, "band": 17, "volume": 17, "macro": 15}


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


# ------------------------------------------------------------------ 지표별 스코어
def _trend(latest, close) -> list[dict]:
    ma20, ma60, ma120 = _num(latest.get("ma20")), _num(latest.get("ma60")), _num(latest.get("ma120"))
    out = []
    # MA 배열
    if None not in (ma20, ma60, ma120):
        cmp1, cmp2 = ma20 > ma60, ma60 > ma120
        if cmp1 and cmp2:
            out.append({"key": "MA 정배열", "score": 2, "phrase": "20·60·120일선이 정배열입니다"})
        elif not cmp1 and not cmp2:
            out.append({"key": "MA 역배열", "score": -2, "phrase": "이동평균선이 역배열입니다"})
        else:
            out.append({"key": "MA 혼조", "score": 0, "phrase": None})
    # 종가 vs MA20
    if ma20 and close:
        gap = (close - ma20) / ma20 * 100
        s = 2 if gap >= 5 else 1 if gap >= 2 else 0 if gap > -2 else -1 if gap > -5 else -2
        out.append({"key": f"MA20 {gap:+.1f}%", "score": s,
                    "phrase": f"종가가 20일선 대비 {gap:+.1f}%에 있습니다" if abs(gap) >= 2 else None})
    return out


def _momentum(latest) -> list[dict]:
    out = []
    rsi = _num(latest.get("rsi14"))
    if rsi is not None:
        if 55 <= rsi <= 70:
            s = 2
        elif 50 <= rsi < 55 or 70 < rsi <= 75:
            s = 1
        elif 45 <= rsi < 50:
            s = 0
        elif rsi < 30 or rsi > 80:
            s = -2
        else:
            s = -1
        if s > 0:
            rsi_phrase = f"RSI가 {rsi:.0f}로 양호합니다"
        elif rsi > 80:
            rsi_phrase = f"RSI가 {rsi:.0f}로 과열입니다"
        elif rsi < 30:
            rsi_phrase = f"RSI가 {rsi:.0f}로 침체입니다"
        else:
            rsi_phrase = None
        out.append({"key": f"RSI {rsi:.0f}", "score": s, "phrase": rsi_phrase})
    macd, sig, hist = _num(latest.get("macd")), _num(latest.get("macd_signal")), _num(latest.get("macd_hist"))
    if None not in (macd, sig, hist):
        if macd > sig and hist > 0:
            out.append({"key": "MACD 골든", "score": 2, "phrase": "MACD가 골든크로스했습니다"})
        elif macd > sig:
            out.append({"key": "MACD 골든", "score": 1, "phrase": None})
        elif macd < sig and hist < 0:
            out.append({"key": "MACD 데드", "score": -2, "phrase": "MACD가 데드크로스했습니다"})
        else:
            out.append({"key": "MACD 데드", "score": -1, "phrase": None})
    return out


def _band(latest, close, df) -> list[dict]:
    out = []
    pb = _num(latest.get("bb_percent_b"))
    if pb is not None:
        if 0.5 <= pb <= 0.8:
            s = 2
        elif 0.8 < pb <= 1.0:
            s = 1
        elif pb < 0.2:
            s = -2
        elif pb > 1.0:
            s = -1
        else:
            s = 0
        out.append({"key": f"%B {pb:.2f}", "score": s,
                    "phrase": f"볼린저 %B가 {pb:.2f}입니다" if s != 0 else None})
    # 밴드폭 스퀴즈: 최근 120일 분위수
    width = _num(latest.get("bb_width"))
    if width is not None and len(df) >= 60:
        recent = df["bb_width"].dropna().tail(120)
        if len(recent) >= 20:
            pct = (recent < width).mean()  # 현재 폭의 백분위
            if pct <= 0.2 and close and _num(latest.get("bb_mid")) and close > latest["bb_mid"]:
                out.append({"key": "스퀴즈 상단돌파", "score": 1, "phrase": "밴드 수축 후 상단을 돌파하고 있습니다"})
            elif pct <= 0.2 and close and _num(latest.get("bb_mid")) and close < latest["bb_mid"]:
                out.append({"key": "스퀴즈 하단이탈", "score": -1, "phrase": None})
            else:
                out.append({"key": "밴드폭 확장", "score": 0, "phrase": None})
    # 엔벨로프 위치
    env_u, env_l, mid = _num(latest.get("env_upper")), _num(latest.get("env_lower")), _num(latest.get("bb_mid"))
    if close and None not in (env_u, env_l, mid):
        if close > env_u:
            out.append({"key": "엔벨로프 상단이탈", "score": -2, "phrase": "엔벨로프 상단을 이탈해 과열입니다"})
        elif close > mid:
            out.append({"key": "엔벨로프 중심상단", "score": 2, "phrase": None})
        elif close < env_l:
            out.append({"key": "엔벨로프 하단이탈", "score": -1, "phrase": None})
        else:
            out.append({"key": "엔벨로프 중심하단", "score": 0, "phrase": None})
    return out


def _volume(latest, up_day) -> list[dict]:
    out = []
    vr = _num(latest.get("vol_ratio20"))
    if vr is not None:
        if vr >= 1.5 and up_day:
            out.append({"key": f"거래량 {vr:.1f}배", "score": 2, "phrase": f"거래량이 20일 평균의 {vr:.1f}배로 늘었습니다"})
        elif vr >= 1.5 and up_day is False:
            out.append({"key": f"거래량 {vr:.1f}배", "score": -2, "phrase": f"하락하며 거래량이 {vr:.1f}배로 늘었습니다"})
        elif vr >= 1.2 and up_day:
            out.append({"key": f"거래량 {vr:.1f}배", "score": 1, "phrase": None})
        elif vr >= 1.2 and up_day is False:
            out.append({"key": f"거래량 {vr:.1f}배", "score": -1, "phrase": None})
        else:
            out.append({"key": f"거래량 {vr:.1f}배", "score": 0, "phrase": None})
    return out


def _obv(slope) -> list[dict]:
    if slope > 0:
        return [{"key": "OBV 상승", "score": 2, "phrase": None}]
    if slope < 0:
        return [{"key": "OBV 하락", "score": -2, "phrase": None}]
    return [{"key": "OBV 보합", "score": 0, "phrase": None}]


def _macro(macro: dict, currency: str, index_ret20, stock_ret20) -> list[dict]:
    out = []
    # 공포지수: 국내는 VKOSPI 우선, 없으면 VIX로 대체. 해외는 VIX.
    vk, vx = _num(macro.get("vkospi")), _num(macro.get("vix"))
    if currency == "KRW" and vk is not None:
        fear, fname = vk, "VKOSPI"
    else:
        fear, fname = vx, "VIX"
    if fear is not None:
        if fear < 15:
            out.append({"key": f"{fname} {fear:.0f}", "score": 2, "phrase": f"{fname}가 {fear:.0f}로 낮아 시장이 안정적입니다"})
        elif fear <= 20:
            out.append({"key": f"{fname} {fear:.0f}", "score": 1, "phrase": None})
        elif fear <= 25:
            out.append({"key": f"{fname} {fear:.0f}", "score": -1, "phrase": None})
        else:
            out.append({"key": f"{fname} {fear:.0f}", "score": -2, "phrase": f"{fname}가 {fear:.0f}로 높아 시장 부담이 있습니다"})

    # 미 10년물 금리 추세 (하락 = 우호, 급등 = 부담)
    r_chg = _num(macro.get("_us10y_chg"))
    if r_chg is not None:
        if r_chg <= -0.10:
            out.append({"key": f"미10년물 {r_chg:+.2f}%p", "score": 1, "phrase": "미 국채금리가 하락세입니다"})
        elif r_chg >= 0.15:
            out.append({"key": f"미10년물 {r_chg:+.2f}%p", "score": -1, "phrase": "미 국채금리가 급등세입니다"})
        else:
            out.append({"key": f"미10년물 {r_chg:+.2f}%p", "score": 0, "phrase": None})

    # USD/KRW 추세 (국내 종목만; 원화 강세 = 우호, 환율 급등 = 부담)
    if currency == "KRW":
        fx_chg, usdkrw = _num(macro.get("_usdkrw_chg")), _num(macro.get("usdkrw"))
        if fx_chg is not None and usdkrw:
            pct = fx_chg / usdkrw * 100
            if pct <= -0.5:
                out.append({"key": f"USD/KRW {pct:+.1f}%", "score": 1, "phrase": "원화가 강세입니다"})
            elif pct >= 1.0:
                out.append({"key": f"USD/KRW {pct:+.1f}%", "score": -1, "phrase": "환율이 급등세입니다"})
            else:
                out.append({"key": f"USD/KRW {pct:+.1f}%", "score": 0, "phrase": None})

    # 상대강도 (지수 대비 20일)
    if index_ret20 is not None and stock_ret20 is not None:
        rs = stock_ret20 - index_ret20
        s = 2 if rs >= 3 else 1 if rs >= 0.5 else 0 if rs > -0.5 else -1 if rs > -3 else -2
        out.append({"key": f"RS {rs:+.1f}%p", "score": s,
                    "phrase": f"지수 대비 20일 상대강도가 {rs:+.1f}%p입니다" if abs(rs) >= 0.5 else None})
    return out


# ------------------------------------------------------------------ 백테스트용: 기술 그룹 평균점수(-2~+2)
def technical_group_avgs(df: pd.DataFrame) -> dict:
    """추세/모멘텀/밴드/거래량 그룹의 평균 지표점수(-2~+2). 매크로 제외."""
    from indicators import obv_slope_20

    latest = df.iloc[-1].to_dict()
    close = _num(latest.get("close"))
    prev_close = _num(df.iloc[-2].get("close")) if len(df) >= 2 else None
    up_day = None if prev_close is None else close > prev_close

    groups = {
        "trend": _trend(latest, close),
        "momentum": _momentum(latest),
        "band": _band(latest, close, df),
        "volume": _volume(latest, up_day) + _obv(obv_slope_20(df)),
    }
    return {
        g: (sum(i["score"] for i in items) / len(items)) if items else 0.0
        for g, items in groups.items()
    }


# ------------------------------------------------------------------ 집계
def _zone(score: int) -> str:
    if score >= 40:
        return "BUY"
    if score >= 15:
        return "BUY_LEAN"
    if score > -15:
        return "NEUTRAL"
    if score > -40:
        return "SELL_LEAN"
    return "SELL"


def _tag(item: dict) -> str:
    s = item["score"]
    pre = "pos" if s > 0 else "neg" if s < 0 else "neu"
    return f"{pre}:{item['key']}"


def _summary(score: int, items: list[dict]) -> str:
    pos = sorted([i for i in items if i["score"] > 0 and i.get("phrase")],
                 key=lambda i: i["score"], reverse=True)
    neg = sorted([i for i in items if i["score"] < 0 and i.get("phrase")],
                 key=lambda i: i["score"])

    # 점수 방향과 같은 쪽을 먼저 서술하고, 반대쪽을 '다만'으로 덧붙인다
    lead, caveat = (pos, neg) if score >= 0 else (neg, pos)

    parts = [p["phrase"] for p in lead[:2]]
    if caveat:
        parts.append("다만 " + caveat[0]["phrase"])
    if not parts:
        return "뚜렷한 방향성 신호가 약해 중립 구간으로 판단됩니다."
    return ". ".join(parts) + "."


def score_signal(
    df: pd.DataFrame,
    macro: dict,
    market: str,
    currency: str,
    index_ret20: float | None = None,
) -> dict:
    """지표 시계열 → 시그널 dict. 데이터 부족 시 UNAVAILABLE."""
    if df is None or len(df) < 130 or _num(df.iloc[-1].get("ma120")) is None:
        return {
            "score": 0, "zone": "UNAVAILABLE", "summary": "",
            "breakdown": {k: 0 for k in WEIGHTS}, "tags": [],
        }

    latest = df.iloc[-1].to_dict()
    close = _num(latest.get("close"))
    prev_close = _num(df.iloc[-2].get("close")) if len(df) >= 2 else None
    up_day = None if prev_close is None else close > prev_close

    stock_ret20 = None
    if len(df) >= 21:
        c0 = _num(df.iloc[-21].get("close"))
        if c0:
            stock_ret20 = (close - c0) / c0 * 100

    from indicators import obv_slope_20

    groups = {
        "trend": _trend(latest, close),
        "momentum": _momentum(latest),
        "band": _band(latest, close, df),
        "volume": _volume(latest, up_day) + _obv(obv_slope_20(df)),
        "macro": _macro(macro or {}, currency, index_ret20, stock_ret20),
    }

    breakdown = {}
    all_items = []
    total = 0.0
    for g, items in groups.items():
        w = WEIGHTS[g]
        if items:
            avg = sum(i["score"] for i in items) / len(items)
        else:
            avg = 0.0
        contrib = round(avg / 2 * w)
        breakdown[g] = contrib
        total += contrib
        for i in items:
            i["_group"] = g
        all_items.extend(items)

    # 매크로 점수 근거 표시용: 지수 대비 20일 상대강도(%p)
    if index_ret20 is not None and stock_ret20 is not None:
        breakdown["rs20"] = round(stock_ret20 - index_ret20, 1)

    score = int(max(-100, min(100, round(total))))
    zone = _zone(score)

    # 태그: 기여 절댓값 상위 5개(비영)
    ranked = sorted([i for i in all_items if i["score"] != 0], key=lambda i: abs(i["score"]), reverse=True)
    tags = [_tag(i) for i in ranked[:5]]
    summary = _summary(score, all_items)

    return {"score": score, "zone": zone, "summary": summary, "breakdown": breakdown, "tags": tags}
