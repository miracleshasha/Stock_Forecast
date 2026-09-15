"""스코어링 엔진.

각 지표를 -2~+2로 점수화 → 그룹 가중합 → -100~+100 정규화 → 구간 판정.
요약 문장과 근거 태그(pos:/neg:/neu: 접두)도 함께 생성합니다.

주의: 가중치·임계값은 기획서 5.1의 초기 제안값입니다.
오픈 전 백테스트로 보정이 필요합니다. (확인이 필요합니다)
"""
from __future__ import annotations

import math

import pandas as pd

import config

# 방향 점수 가중치(합 100). 매크로는 2026-09 재설계로 방향에서 빠졌습니다(아래 참고).
# 주의: 34/17/17/17 비율은 풀링 IC라는 잘못된 지표로 튜닝된 값을 이어받은 것입니다.
#       backtest.py 의 IC 계산을 표준(날짜별 횡단면)으로 고쳤으므로 재도출이 필요합니다.
WEIGHTS = {"trend": 40, "momentum": 20, "band": 20, "volume": 20}

# ---- 매크로: 방향이 아니라 확신도 ----
# 2026-09 검증에서 시장공통 매크로(VIX 레벨·금리/환율 변화)는 지수 미래수익률과
# 일관되게 '역방향'이었습니다(FRED 8년, H=60 IC -0.23). 항목 후보를 바꿔봐도
# 기간을 쪼개면 부호와 크기가 심하게 흔들려, 방향을 맡길 만한 것이 없었습니다.
#
# 대신 안정적으로 관측된 것은 이쪽입니다 — 기술 점수의 횡단면 IC가
#   저변동(VIX<16) +0.014 / 중간 +0.029 / 고변동(VIX>=18) -0.067
# 로, 불안정한 장에서 신호가 뒤집힙니다. 그래서 매크로는 방향을 더하지 않고
# |점수|를 줄여 판정을 중립 쪽으로 당깁니다. 같은 날짜 안에서는 모든 종목에
# 같은 배수가 걸리므로 종목 간 순위는 바뀌지 않습니다 — 바뀌는 건 확신도뿐입니다.
STRESS_DAMP = [(16, 1.0), (20, 0.85), (25, 0.70), (999, 0.50)]


def group_avg(items: list[dict]) -> float:
    """그룹 점수(-2~+2). 항목별 가중치 w(기본 1.0)를 반영한 가중평균.

    단순 평균이면 항목을 추가할수록 기존 항목이 희석되고, 시장에 따라 항목
    수가 달라질 때(국내는 환율 항목이 더 붙음) 같은 지표가 다른 무게를 갖게
    됩니다. 가중평균으로 바꿔 항목별 상대 중요도를 명시합니다.

    w는 모두 1.0으로 시작합니다. 임의로 조정하면 검증되지 않은 튜닝이 되므로,
    backtest.py 로 측정한 뒤 조정하세요.
    """
    if not items:
        return 0.0
    tw = sum(i.get("w", 1.0) for i in items)
    if tw <= 0:
        return 0.0
    return sum(i["score"] * i.get("w", 1.0) for i in items) / tw


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

    if not config.TREND_EXTRA:
        return out

    # --- 아래는 TREND_EXTRA=1 일 때만 반영 ---
    # ADX/DMI — 추세의 '강도'. MA 배열은 방향만 알려주므로, 횡보장에서 살짝
    # 정배열인 것을 강한 추세로 오인하는 것을 막습니다.
    adx = _num(latest.get("adx14"))
    pdi, mdi = _num(latest.get("plus_di14")), _num(latest.get("minus_di14"))
    if None not in (adx, pdi, mdi):
        up = pdi > mdi
        if adx >= 25:
            s = 2 if up else -2
            ph = f"ADX {adx:.0f}로 {'상승' if up else '하락'}추세가 강합니다"
        elif adx >= 20:
            s, ph = (1 if up else -1), None
        else:
            s, ph = 0, "ADX가 낮아 뚜렷한 추세가 없습니다"
        out.append({"key": f"ADX {adx:.0f}", "score": s, "phrase": ph})

    # MA20 기울기 — 정배열이어도 이동평균선이 꺾이는 중인 경우(고점 직후)를 잡습니다.
    slope = _num(latest.get("ma20_slope10"))
    if slope is not None:
        s = 2 if slope >= 2 else 1 if slope >= 0.5 else 0 if slope > -0.5 else -1 if slope > -2 else -2
        out.append({"key": f"MA20기울기 {slope:+.1f}%", "score": s,
                    "phrase": f"20일선이 10거래일간 {slope:+.1f}% 움직였습니다" if abs(slope) >= 2 else None})

    # 52주 고가 대비 위치 — 추세추종에서 가장 견고한 단일 신호 중 하나.
    p52 = _num(latest.get("pct_from_52w_high"))
    if p52 is not None:
        s = 2 if p52 >= -5 else 1 if p52 >= -15 else 0 if p52 >= -30 else -1 if p52 >= -50 else -2
        ph = None
        if p52 >= -5:
            ph = "52주 고가 부근입니다"
        elif p52 < -30:
            ph = f"52주 고가 대비 {p52:.0f}% 낮은 지점입니다"
        out.append({"key": f"52주고가 {p52:+.0f}%", "score": s, "phrase": ph})

    return out


def _momentum(latest, index_ret20=None, stock_ret20=None) -> list[dict]:
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
    # 상대강도(지수 대비 20일) — 종목마다 값이 다른 '상대 모멘텀'.
    # 시장공통 매크로와 성격이 달라 매크로 그룹에서 이쪽으로 옮겼습니다.
    out += _macro_rs(index_ret20, stock_ret20)

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


def macro_market_items(macro: dict, currency: str) -> list[dict]:
    """시장 공통 매크로 항목(공포지수·금리·환율).

    종목과 무관하게 모든 종목이 같은 값을 받습니다. 따라서 횡단면 IC로는
    예측력을 측정할 수 없고, 지수 수익률을 상대로 한 '시장 타이밍' 관점으로
    검증해야 합니다. backtest.py --macro 가 이 함수를 그대로 씁니다.
    """
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

    return out


def _macro_rs(index_ret20, stock_ret20) -> list[dict]:
    """상대강도(지수 대비 20일) — 종목마다 값이 다른 횡단면 항목.

    시장 공통 항목과 성격이 완전히 달라(이쪽은 횡단면 IC로 검증 가능) 분리해
    둡니다. 출력 스키마 호환을 위해 그룹은 macro 그대로 둡니다.
    """
    if index_ret20 is None or stock_ret20 is None:
        return []
    rs = stock_ret20 - index_ret20
    s = 2 if rs >= 3 else 1 if rs >= 0.5 else 0 if rs > -0.5 else -1 if rs > -3 else -2
    return [{"key": f"RS {rs:+.1f}%p", "score": s,
             "phrase": f"지수 대비 20일 상대강도가 {rs:+.1f}%p입니다" if abs(rs) >= 0.5 else None}]


def stress_damp(macro: dict, currency: str) -> float:
    """시장 불안정 국면의 확신도 배수(0.5~1.0). 방향은 건드리지 않습니다."""
    vk, vx = _num((macro or {}).get("vkospi")), _num((macro or {}).get("vix"))
    fear = vk if (currency == "KRW" and vk is not None) else vx
    if fear is None:
        return 1.0
    for cap, mult in STRESS_DAMP:
        if fear < cap:
            return mult
    return 1.0


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
    return {g: group_avg(items) for g, items in groups.items()}


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
            "breakdown": {**{k: 0 for k in WEIGHTS}, "macro": 0, "damp": 1.0}, "tags": [],
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
        "momentum": _momentum(latest, index_ret20, stock_ret20),
        "band": _band(latest, close, df),
        "volume": _volume(latest, up_day) + _obv(obv_slope_20(df)),
    }

    breakdown = {}
    all_items = []
    total = 0.0
    for g, items in groups.items():
        w = WEIGHTS[g]
        contrib = round(group_avg(items) / 2 * w)
        breakdown[g] = contrib
        total += contrib
        for i in items:
            i["_group"] = g
        all_items.extend(items)

    # 매크로 점수 근거 표시용: 지수 대비 20일 상대강도(%p)
    if index_ret20 is not None and stock_ret20 is not None:
        breakdown["rs20"] = round(stock_ret20 - index_ret20, 1)

    # 시장 불안정 국면이면 확신도를 낮춥니다(방향은 그대로, |점수|만 축소).
    damp = stress_damp(macro, currency)
    score = int(max(-100, min(100, round(total * damp))))
    breakdown["macro"] = 0      # 방향 기여 없음. 웹 호환을 위해 키는 유지합니다.
    breakdown["damp"] = round(damp, 2)
    zone = _zone(score)

    # 태그: 기여 절댓값 상위 5개(비영)
    ranked = sorted([i for i in all_items if i["score"] != 0], key=lambda i: abs(i["score"]), reverse=True)
    tags = [_tag(i) for i in ranked[:5]]
    summary = _summary(score, all_items)

    return {"score": score, "zone": zone, "summary": summary, "breakdown": breakdown, "tags": tags}
