"""배치 실행 진입점.

[쓰기 경로]
  symbols(Supabase) 로드
    → 매크로 수집 → daily_macro 업서트
    → 종목별: 일봉 수집 → 지표 계산 → 스코어링
              → daily_prices / daily_indicators / daily_signals 업서트

종목 단위로 재시도하며, 한 종목 실패가 전체를 막지 않습니다.
사용법:
  python run.py                # 전체 활성 종목
  python run.py 005930 AAPL    # 특정 종목만
"""
from __future__ import annotations

import sys
import traceback

import pandas as pd

import config
import indicators
import kis_client
import macro as macro_mod
import scoring
import supabase_io


def _clean(v):
    if v is None:
        return None
    if isinstance(v, float) and pd.isna(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    return v


def _price_rows(ticker: str, df: pd.DataFrame) -> list[dict]:
    rows = []
    for _, r in df.iterrows():
        rows.append({
            "ticker": ticker,
            "trade_date": kis_client.iso(str(r["date"])),
            "open": _clean(r.get("open")),
            "high": _clean(r.get("high")),
            "low": _clean(r.get("low")),
            "close": _clean(r.get("close")),
            "volume": int(r.get("volume") or 0),
        })
    return rows


IND_COLS = [
    "ma20", "ma60", "ma120", "bb_upper", "bb_mid", "bb_lower",
    "bb_percent_b", "bb_width", "env_upper", "env_lower", "rsi14",
    "macd", "macd_signal", "macd_hist", "vol_ratio20", "obv",
]


def _indicator_rows(ticker: str, df: pd.DataFrame) -> list[dict]:
    rows = []
    for _, r in df.iterrows():
        row = {"ticker": ticker, "trade_date": kis_client.iso(str(r["date"]))}
        for c in IND_COLS:
            val = _clean(r.get(c))
            if c == "obv" and val is not None:
                val = int(val)
            row[c] = val
        rows.append(row)
    return rows


def process_symbol(sym: dict, macro: dict) -> bool:
    ticker = sym["ticker"]
    market = sym["market"]
    currency = sym.get("currency", "KRW")
    name = sym.get("name_ko") or sym.get("name_en") or ticker

    # 1) 일봉 수집
    if currency == "KRW":
        candles = kis_client.fetch_domestic_daily(ticker, config.LOOKBACK_TRADING_DAYS)
    else:
        candles, real_market = kis_client.fetch_overseas_daily(ticker, market, config.LOOKBACK_TRADING_DAYS)
        # 거래소 자동보정: 저장된 market이 실제와 다르면 갱신
        if candles and real_market != market:
            supabase_io.upsert("symbols", [{"ticker": ticker, "market": real_market, "currency": currency}], "ticker")
            market = real_market

    if not candles:
        print(f"  ✗ {ticker} {name}: 시세 없음")
        return False

    # 2) 지표
    df = indicators.compute(candles)

    # 3) 스코어링
    index_ret20 = macro.get("_kospi_ret20") if currency == "KRW" else None
    sig = scoring.score_signal(df, macro, market, currency, index_ret20)

    # 4) 업서트
    supabase_io.upsert("daily_prices", _price_rows(ticker, df), "ticker,trade_date")
    supabase_io.upsert("daily_indicators", _indicator_rows(ticker, df), "ticker,trade_date")

    trade_date = kis_client.iso(str(df.iloc[-1]["date"]))
    supabase_io.upsert("daily_signals", [{
        "ticker": ticker,
        "trade_date": trade_date,
        "score": sig["score"],
        "zone": sig["zone"],
        "summary": sig["summary"],
        "breakdown": sig["breakdown"],
        "tags": sig["tags"],
    }], "ticker,trade_date")

    print(f"  ✓ {ticker} {name}: {sig['zone']} ({sig['score']:+d}) · {trade_date} · {len(df)}행")
    return True


def prune():
    """시세가 채워지지 않은(무효/상폐) 종목을 symbols에서 제거."""
    config.require_supabase()
    symbols = supabase_io.get_active_symbols()
    have = supabase_io.get_signal_tickers()
    dead = [s["ticker"] for s in symbols if s["ticker"] not in have]
    if not dead:
        print("정리할 종목 없음.")
        return
    print(f"데이터 없는 {len(dead)}종목 삭제: {', '.join(dead[:20])}{' …' if len(dead) > 20 else ''}")
    supabase_io.delete_symbols(dead)
    print("정리 완료.")


def main(argv: list[str]):
    if argv and argv[0] == "--prune":
        prune()
        return

    config.require_kis()
    config.require_supabase()

    symbols = supabase_io.get_active_symbols()
    if argv:
        wanted = set(argv)
        symbols = [s for s in symbols if s["ticker"] in wanted]
    if not symbols:
        raise SystemExit("대상 종목이 없습니다. db/seed_symbols.sql 을 먼저 실행했는지 확인하세요.")

    print(f"[1/2] 매크로 수집…")
    macro = macro_mod.collect()
    if macro.get("trade_date"):
        supabase_io.upsert("daily_macro", [{
            k: macro[k] for k in
            ("trade_date", "vix", "vkospi", "us10y", "dxy", "usdkrw", "kospi_close", "spx_close")
        }], "trade_date")
        print(f"  매크로 기준일 {macro['trade_date']} · KOSPI {macro.get('kospi_close')}")
    else:
        print("  매크로 수집 실패(계속 진행)")

    print(f"[2/2] 종목 {len(symbols)}개 처리…")
    ok = fail = 0
    for sym in symbols:
        try:
            if process_symbol(sym, macro):
                ok += 1
            else:
                fail += 1
        except Exception as e:  # noqa: BLE001
            fail += 1
            print(f"  ✗ {sym['ticker']} 오류: {e}")
            traceback.print_exc()

    print(f"\n완료: 성공 {ok} · 실패 {fail}")
    if fail and not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main(sys.argv[1:])
