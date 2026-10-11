"""단기 신호: 캔들 패턴 + 가격 위치·거래량 (일봉 기준).

판정 점수(추세·모멘텀·밴드·거래량)와 별개인 '최근 며칠의 모양' 요약입니다.
교과서적인 정의를 따르되, 어느 패턴이든 '앞선 흐름'이 조건에 들어갑니다
(같은 망치 모양도 하락 뒤에 나와야 망치형, 상승 뒤면 교수형).

각 패턴이 실제로 그 뒤 며칠 어떻게 움직였는지는 pattern_backtest.py 가
우리 데이터로 측정해 pattern_stats 테이블에 넣습니다. 화면에는 그 실측치를 보여줍니다
(인터넷 도표의 '신뢰도 ★' 같은 근거 없는 등급 대신).

시간대 규칙(아침 폭등·오후 폭락 등)은 분봉이 있어야 해서 다루지 않습니다.
쌍바닥·삼존 같은 차트 패턴은 판정이 주관적이라 1차에서 제외했습니다.
"""
from __future__ import annotations

import math

import pandas as pd

# key → (한글 이름, 방향 +1 상승/-1 하락/0 중립, 쉬운 설명)
PATTERNS: dict[str, tuple[str, int, str]] = {
    "hammer": ("망치형", 1, "하락 뒤 아래꼬리가 긴 봉 — 장중 매도를 받아내고 회복했어요"),
    "inverted_hammer": ("역망치형", 1, "하락 뒤 위꼬리가 긴 봉 — 반등 시도가 나왔어요"),
    "hanging_man": ("교수형", -1, "상승 뒤 아래꼬리가 긴 봉 — 고점에서 매도가 나오기 시작했어요"),
    "shooting_star": ("유성형", -1, "상승 뒤 위꼬리가 긴 봉 — 고점에서 밀려 내려왔어요"),
    "doji": ("도지", 0, "시가와 종가가 거의 같아요 — 사자·팔자 힘이 팽팽해요"),
    "dragonfly_doji": ("잠자리형 도지", 1, "하락 뒤 아래꼬리만 긴 도지 — 저가 매수세가 들어왔어요"),
    "gravestone_doji": ("비석형 도지", -1, "상승 뒤 위꼬리만 긴 도지 — 고가에서 되밀렸어요"),
    "long_bull": ("장대양봉", 1, "평소보다 훨씬 큰 양봉 — 사는 힘이 강했어요"),
    "long_bear": ("장대음봉", -1, "평소보다 훨씬 큰 음봉 — 파는 힘이 강했어요"),
    "bull_engulfing": ("상승 장악형", 1, "하락 뒤 양봉이 전날 음봉을 통째로 감쌌어요"),
    "bear_engulfing": ("하락 장악형", -1, "상승 뒤 음봉이 전날 양봉을 통째로 감쌌어요"),
    "piercing": ("관통형", 1, "하락 뒤 양봉이 전날 음봉의 절반 위까지 올라왔어요"),
    "dark_cloud": ("먹구름형", -1, "상승 뒤 음봉이 전날 양봉의 절반 아래까지 내려왔어요"),
    "bull_harami": ("상승 잉태형", 1, "하락 뒤 큰 음봉 안에 작은 양봉 — 하락 힘이 약해졌어요"),
    "bear_harami": ("하락 잉태형", -1, "상승 뒤 큰 양봉 안에 작은 음봉 — 상승 힘이 약해졌어요"),
    "tweezer_bottom": ("집게 바닥", 1, "하락 뒤 이틀 연속 같은 저가에서 받쳐졌어요"),
    "tweezer_top": ("집게 천장", -1, "상승 뒤 이틀 연속 같은 고가에서 막혔어요"),
    "morning_star": ("샛별형", 1, "큰 음봉 → 작은 봉 → 큰 양봉, 하락이 멈추는 3일 모양이에요"),
    "evening_star": ("석별형", -1, "큰 양봉 → 작은 봉 → 큰 음봉, 상승이 멈추는 3일 모양이에요"),
    "three_white_soldiers": ("적삼병", 1, "양봉 3개가 연달아 높아졌어요"),
    "three_black_crows": ("흑삼병", -1, "음봉 3개가 연달아 낮아졌어요"),
    # 볼린저 밴드(20일, ±2σ) 통과 — 어제와 오늘 종가가 밴드선을 사이에 두고 갈린 날
    "bb_lower_break": ("볼린저 하단 이탈", 1, "종가가 볼린저 하단 아래로 내려갔어요 — 과매도 구간, 교과서상 매수 고려 자리예요"),
    "bb_lower_reentry": ("볼린저 하단 복귀", 1, "하단 아래에 있던 종가가 밴드 안으로 돌아왔어요 — 반등이 시작될 수 있는 자리예요"),
    "bb_upper_break": ("볼린저 상단 돌파", -1, "종가가 볼린저 상단 위로 올라갔어요 — 과열 구간, 교과서상 매도(차익) 고려 자리예요"),
    "bb_upper_reentry": ("볼린저 상단 복귀", -1, "상단 위에 있던 종가가 밴드 안으로 내려왔어요 — 상승 힘이 꺾일 수 있는 자리예요"),
    # 가격 위치(최근 20일 범위 안) × 거래량(20일 평균 대비)
    "low_volume_surge": ("저가권 거래량 급증", 1, "20일 중 낮은 자리에서 거래가 평소의 2배 넘게 터졌어요"),
    "high_volume_surge": ("고가권 거래량 급증", -1, "20일 중 높은 자리에서 거래가 평소의 2배 넘게 터졌어요"),
    "low_volume_dry": ("저가권 거래 한산", 0, "낮은 자리에서 거래가 줄었어요 — 방향을 기다리는 중이에요"),
    "high_volume_dry": ("고가권 거래 한산", 0, "높은 자리에서 거래가 줄었어요 — 매수 열기가 식고 있어요"),
}

TREND_LOOKBACK = 5     # 앞선 흐름 판단 기간(거래일)
TREND_PCT = 3.0        # 그 기간 ±3% 이상이면 상승/하락 흐름으로 봄
AVG_BODY_DAYS = 10     # '평소 몸통 크기' 기준


def _f(v) -> float:
    try:
        x = float(v)
        return x if math.isfinite(x) else float("nan")
    except (TypeError, ValueError):
        return float("nan")


def detect_at(df: pd.DataFrame, i: int) -> list[str]:
    """i번째 봉(그날 종가 기준)에서 성립하는 패턴 key 목록. 데이터가 모자라면 []."""
    if i < max(TREND_LOOKBACK + 3, AVG_BODY_DAYS + 1, 20):
        return []
    o, h, l, c = (df["open"].values, df["high"].values, df["low"].values, df["close"].values)

    def bar(k):
        oo, hh, ll, cc = _f(o[k]), _f(h[k]), _f(l[k]), _f(c[k])
        body = abs(cc - oo)
        rng = hh - ll
        return {
            "o": oo, "h": hh, "l": ll, "c": cc, "body": body, "rng": rng,
            "up": hh - max(oo, cc), "lo": min(oo, cc) - ll, "bull": cc > oo, "bear": cc < oo,
            "mid": (oo + cc) / 2,
        }

    b0, b1, b2 = bar(i), bar(i - 1), bar(i - 2)
    if any(math.isnan(x) for x in (b0["o"], b0["h"], b0["l"], b0["c"])) or b0["rng"] <= 0:
        return []

    # 오늘 봉 이전의 흐름 (패턴이 3봉짜리면 그 앞을 봐야 하지만, 단순화를 위해 공통 기준 사용)
    def trend_before(k: int) -> int:
        a, z = _f(c[k - TREND_LOOKBACK]), _f(c[k])
        if not (a > 0) or math.isnan(z):
            return 0
        chg = (z / a - 1) * 100
        return 1 if chg >= TREND_PCT else -1 if chg <= -TREND_PCT else 0

    t1 = trend_before(i - 1)   # 1~2봉 패턴용: 어제까지의 흐름
    t3 = trend_before(i - 3)   # 3봉 패턴용: 패턴 시작 전 흐름
    bodies = [abs(_f(c[k]) - _f(o[k])) for k in range(i - AVG_BODY_DAYS, i)]
    avg_body = sum(x for x in bodies if not math.isnan(x)) / max(1, len(bodies))
    out: list[str] = []

    # ---- 1봉 ----
    small_upper = b0["up"] <= 0.15 * b0["rng"]
    small_lower = b0["lo"] <= 0.15 * b0["rng"]
    is_doji = b0["body"] <= 0.1 * b0["rng"]
    if b0["body"] > 0 and not is_doji:
        if b0["lo"] >= 2 * b0["body"] and small_upper:
            out.append("hammer" if t1 < 0 else "hanging_man" if t1 > 0 else "")
        if b0["up"] >= 2 * b0["body"] and small_lower:
            out.append("inverted_hammer" if t1 < 0 else "shooting_star" if t1 > 0 else "")
    if is_doji:
        if b0["up"] <= 0.1 * b0["rng"] and b0["lo"] >= 0.6 * b0["rng"] and t1 < 0:
            out.append("dragonfly_doji")
        elif b0["lo"] <= 0.1 * b0["rng"] and b0["up"] >= 0.6 * b0["rng"] and t1 > 0:
            out.append("gravestone_doji")
        else:
            out.append("doji")
    if avg_body > 0 and b0["body"] >= 2 * avg_body and b0["body"] >= 0.7 * b0["rng"]:
        out.append("long_bull" if b0["bull"] else "long_bear" if b0["bear"] else "")

    # ---- 2봉 ----
    if t1 < 0 and b1["bear"] and b0["bull"] and b0["o"] <= b1["c"] and b0["c"] >= b1["o"] and b0["body"] > b1["body"]:
        out.append("bull_engulfing")
    if t1 > 0 and b1["bull"] and b0["bear"] and b0["o"] >= b1["c"] and b0["c"] <= b1["o"] and b0["body"] > b1["body"]:
        out.append("bear_engulfing")
    if (t1 < 0 and b1["bear"] and b1["body"] >= avg_body and b0["bull"] and b0["o"] < b1["c"]
            and b1["mid"] < b0["c"] < b1["o"]):
        out.append("piercing")
    if (t1 > 0 and b1["bull"] and b1["body"] >= avg_body and b0["bear"] and b0["o"] > b1["c"]
            and b1["o"] < b0["c"] < b1["mid"]):
        out.append("dark_cloud")
    inside = max(b0["o"], b0["c"]) <= max(b1["o"], b1["c"]) and min(b0["o"], b0["c"]) >= min(b1["o"], b1["c"])
    if inside and b1["body"] >= avg_body and b0["body"] <= 0.5 * b1["body"]:
        if t1 < 0 and b1["bear"] and b0["bull"]:
            out.append("bull_harami")
        if t1 > 0 and b1["bull"] and b0["bear"]:
            out.append("bear_harami")
    if t1 < 0 and b1["bear"] and b0["bull"] and abs(b0["l"] - b1["l"]) <= 0.002 * b1["l"]:
        out.append("tweezer_bottom")
    if t1 > 0 and b1["bull"] and b0["bear"] and abs(b0["h"] - b1["h"]) <= 0.002 * b1["h"]:
        out.append("tweezer_top")

    # ---- 3봉 ----
    if avg_body > 0:
        if (t3 < 0 and b2["bear"] and b2["body"] >= avg_body and b1["body"] <= 0.3 * b2["body"]
                and max(b1["o"], b1["c"]) <= b2["c"] + 0.1 * b2["body"]
                and b0["bull"] and b0["c"] >= b2["mid"]):
            out.append("morning_star")
        if (t3 > 0 and b2["bull"] and b2["body"] >= avg_body and b1["body"] <= 0.3 * b2["body"]
                and min(b1["o"], b1["c"]) >= b2["c"] - 0.1 * b2["body"]
                and b0["bear"] and b0["c"] <= b2["mid"]):
            out.append("evening_star")

        def soldiers(sign: int) -> bool:
            bs = (b2, b1, b0)
            for k, b in enumerate(bs):
                if (sign > 0 and not b["bull"]) or (sign < 0 and not b["bear"]):
                    return False
                if b["body"] < 0.5 * avg_body:
                    return False
                shadow = b["up"] if sign > 0 else b["lo"]
                if shadow > 0.5 * b["body"]:
                    return False
                if k > 0:
                    p = bs[k - 1]
                    if sign > 0 and not (b["c"] > p["c"] and p["o"] <= b["o"] <= p["c"]):
                        return False
                    if sign < 0 and not (b["c"] < p["c"] and p["c"] <= b["o"] <= p["o"]):
                        return False
            return True

        if soldiers(1):
            out.append("three_white_soldiers")
        if soldiers(-1):
            out.append("three_black_crows")

    # ---- 볼린저 밴드 통과 (어제 → 오늘 종가) ----
    if "bb_upper" in df and "bb_lower" in df:
        up0, lo0 = _f(df["bb_upper"].values[i]), _f(df["bb_lower"].values[i])
        up1, lo1 = _f(df["bb_upper"].values[i - 1]), _f(df["bb_lower"].values[i - 1])
        c1 = b1["c"]
        if not any(math.isnan(x) for x in (up0, lo0, up1, lo1, c1)):
            if c1 >= lo1 and b0["c"] < lo0:
                out.append("bb_lower_break")
            elif c1 < lo1 and b0["c"] >= lo0:
                out.append("bb_lower_reentry")
            if c1 <= up1 and b0["c"] > up0:
                out.append("bb_upper_break")
            elif c1 > up1 and b0["c"] <= up0:
                out.append("bb_upper_reentry")

    # ---- 가격 위치 × 거래량 ----
    hi20 = max(_f(x) for x in h[i - 19:i + 1])
    lo20 = min(_f(x) for x in l[i - 19:i + 1])
    vr = _f(df["vol_ratio20"].values[i]) if "vol_ratio20" in df else float("nan")
    if hi20 > lo20 and not math.isnan(vr):
        pos = (b0["c"] - lo20) / (hi20 - lo20)
        if pos <= 0.2 and vr >= 2:
            out.append("low_volume_surge")
        elif pos >= 0.8 and vr >= 2:
            out.append("high_volume_surge")
        elif pos <= 0.2 and vr <= 0.6:
            out.append("low_volume_dry")
        elif pos >= 0.8 and vr <= 0.6:
            out.append("high_volume_dry")

    return [k for k in out if k]


def summarize(keys: list[str]) -> dict:
    """화면용 요약. 방향 합으로 단기 판단 한 줄을 정합니다."""
    items = [{"key": k, "name": PATTERNS[k][0], "dir": PATTERNS[k][1], "desc": PATTERNS[k][2]} for k in keys]
    up = sum(1 for x in items if x["dir"] > 0)
    down = sum(1 for x in items if x["dir"] < 0)
    if not items:
        label, tone = "특별한 패턴 없음", 0
    elif up and not down:
        label, tone = "단기 반등 신호", 1
    elif down and not up:
        label, tone = "단기 하락 신호", -1
    elif up and down:
        label, tone = "신호가 엇갈려요", 0
    else:
        label, tone = "방향 탐색 중", 0
    return {"label": label, "tone": tone, "patterns": items}


def short_term(df: pd.DataFrame) -> dict:
    """마지막 봉 기준 단기 신호 요약 (daily_signals.short_term 에 저장)."""
    return summarize(detect_at(df, len(df) - 1))
