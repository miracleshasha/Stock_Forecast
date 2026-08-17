"""합성 데이터로 지표·스코어링 파이프라인 검증 (KIS/Supabase 불필요)."""
import math
import indicators
import scoring


def make_series(n, trend, vol=0.01, base=100.0, seed=1):
    import random
    random.seed(seed)
    candles = []
    price = base
    from datetime import date, timedelta
    d = date(2024, 1, 1)
    for i in range(n):
        price *= (1 + trend + random.uniform(-vol, vol))
        o = price * (1 + random.uniform(-0.003, 0.003))
        h = max(o, price) * (1 + random.uniform(0, 0.005))
        l = min(o, price) * (1 - random.uniform(0, 0.005))
        v = int(1_000_000 * (1 + random.uniform(-0.3, 0.6)))
        candles.append({
            "date": (d + timedelta(days=i)).strftime("%Y%m%d"),
            "open": round(o, 2), "high": round(h, 2), "low": round(l, 2),
            "close": round(price, 2), "volume": v,
        })
    return candles


def run(label, trend):
    candles = make_series(200, trend)
    df = indicators.compute(candles)
    last = df.iloc[-1]
    macro = {"vkospi": 16.0, "vix": 18.0}
    sig = scoring.score_signal(df, macro, "KOSPI", "KRW", index_ret20=0.0)
    print(f"\n=== {label} (trend={trend:+.4f}/day) ===")
    print(f"  close={last['close']:.2f} ma20={last['ma20']:.2f} ma120={last['ma120']:.2f}")
    print(f"  rsi14={last['rsi14']:.1f} %B={last['bb_percent_b']:.2f} macd_hist={last['macd_hist']:.3f}")
    print(f"  SCORE {sig['score']:+d}  ZONE {sig['zone']}")
    print(f"  breakdown {sig['breakdown']}")
    print(f"  tags {sig['tags']}")
    print(f"  summary: {sig['summary']}")
    assert -100 <= sig["score"] <= 100
    assert sum(sig["breakdown"].values()) != None
    return sig


up = run("상승 추세", 0.006)
down = run("하락 추세", -0.006)
flat = run("보합", 0.0)

# 상승 추세는 하락 추세보다 점수가 높아야 한다
assert up["score"] > down["score"], "상승>하락 점수 관계 위반"
print("\nOK: 상승 점수 > 하락 점수, 모든 점수 범위 정상")

# 데이터 부족 → UNAVAILABLE
short = indicators.compute(make_series(50, 0.003))
s2 = scoring.score_signal(short, {}, "KOSPI", "KRW")
assert s2["zone"] == "UNAVAILABLE", s2
print("OK: 데이터 부족 시 UNAVAILABLE")
