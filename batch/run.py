"""배치 실행 진입점.

[쓰기 경로]
  symbols(Supabase) 로드
    → 매크로 수집 → daily_macro 업서트
    → 종목별: 일봉 수집 → 지표 계산 → 스코어링
              → daily_prices / daily_indicators / daily_signals 업서트

[수집 모드 — 하이브리드]
  증분(기본, 평일 18:30): DB의 최근 REVISION_ROWS 거래일 이후만 KIS에서 받고, 지표
      워밍업 구간(WARMUP_ROWS)은 daily_prices에서 읽어 이어붙입니다. 종목당 KIS 1회.
  전량(--full, 토요일 09:00): 400거래일을 통째로 다시 받아 수정주가(액면분할 등)
      소급 반영과 누락분 복구를 합니다. 종목당 KIS 4~5회.

  DB에 이력이 없는 종목(신규 편입)은 증분 모드에서도 자동으로 전량 수집합니다.
  증분도 최근 며칠은 매번 다시 받아 덮어쓰므로(REVISION_ROWS) 거래량 정정 같은
  뒤늦은 변경은 다음 실행이 알아서 고칩니다.

종목 단위로 재시도하며, 한 종목 실패가 전체를 막지 않습니다.
[시장 분리]
  각 시장은 그 시장이 닫힌 직후에만 받으면 됩니다. --kr / --us 로 대상을 나눠
  국내는 18:30(장 마감 15:30 이후), 해외는 07:00(미국장 마감 05~06시 이후)에
  돌립니다. 전 종목을 두 번 도는 게 아니므로 호출량은 하루 1회 때와 같습니다.

사용법:
  python run.py                # 전체 활성 종목(증분)
  python run.py --kr           # 국내 종목만(증분)
  python run.py --us           # 해외 종목만(증분)
  python run.py --full         # 전체 활성 종목(전량 재적재)
  python run.py 005930 AAPL    # 특정 종목만(증분)
  python run.py --full 005930  # 특정 종목만 전량
"""
from __future__ import annotations

import sys
import traceback
from datetime import datetime, timedelta

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


def _drop_incomplete(candles: list[dict]) -> list[dict]:
    """정규장이 끝나지 않은 해외 일봉(프리마켓 체결분만 담긴 행)을 버립니다.

    KIS는 미국장 개장 전에도 그날 날짜의 행을 내려주는데, 거래량이 정규장의 1%도
    안 되는 미완성 값입니다. 이걸 저장하면 지표·판정이 통째로 왜곡됩니다.
    """
    if not config.SKIP_INCOMPLETE_OVERSEAS:
        return candles
    now = datetime.now()
    return [
        r for r in candles
        if now >= datetime.strptime(r["date"], "%Y%m%d") + timedelta(hours=config.OVERSEAS_SETTLE_HOURS)
    ]


def _fetch_candles(sym: dict, target_rows: int) -> tuple[list[dict], str]:
    """KIS 일봉 조회. 해외는 거래소 자동보정까지 처리해 (rows, market)을 반환."""
    ticker = sym["ticker"]
    market = sym["market"]
    currency = sym.get("currency", "KRW")

    if currency == "KRW":
        return kis_client.fetch_domestic_daily(ticker, target_rows), market

    candles, real_market = kis_client.fetch_overseas_daily(ticker, market, target_rows)
    # 저장된 market이 실제와 다르면 갱신
    if candles and real_market != market:
        supabase_io.upsert(
            "symbols", [{"ticker": ticker, "market": real_market, "currency": currency}], "ticker"
        )
    return _drop_incomplete(candles), real_market


def _rows_needed_since(anchor_date: str) -> int:
    """기준일(재검증 윈도우 시작점) 이후를 덮는 데 필요한 행수.

    거래일 수 ≤ 달력일 수 이므로 달력일 기준으로 잡으면 갭을 반드시 포함합니다.
    (연휴·장기 중단으로 갭이 커지면 자동으로 여러 페이지를 받습니다.)
    """
    gap = (datetime.now() - datetime.strptime(anchor_date, "%Y%m%d")).days
    return max(config.MIN_INCREMENTAL_ROWS, min(config.LOOKBACK_TRADING_DAYS, gap + 2))


def _load_history(ticker: str, full: bool) -> list[dict]:
    """증분 모드에서 쓸 과거 일봉(워밍업). 실패하면 빈 리스트 → 전량 폴백."""
    if full:
        return []
    try:
        return supabase_io.get_recent_prices(ticker, config.WARMUP_ROWS)
    except Exception as e:  # noqa: BLE001
        print(f"  ! {ticker} 이력 조회 실패({e}) → 전량 수집으로 폴백")
        return []


def _align_obv(ticker: str, df: pd.DataFrame, anchor_date: str):
    """OBV 누적합 기준점을 DB에 저장된 값에 맞춰 평행이동.

    OBV는 계산 구간 시작점부터의 누적합이라 워밍업 구간이 달라지면 절대값이
    통째로 어긋납니다. 웹이 OBV 절대값을 그대로 표시하므로 연속성을 맞춥니다.
    기준일은 이번에 덮어쓰지 않는 날짜(재검증 윈도우 바로 앞)여야 합니다.
    """
    try:
        a_obv = supabase_io.get_obv_at(ticker, anchor_date)
    except Exception:  # noqa: BLE001
        return
    if a_obv is None:
        return
    hit = df.index[df["date"] == anchor_date]
    if len(hit) == 0 or pd.isna(df.loc[hit[0], "obv"]):
        return
    df["obv"] = df["obv"] + (a_obv - float(df.loc[hit[0], "obv"]))


def process_symbol(sym: dict, macro: dict, full: bool = False) -> bool:
    ticker = sym["ticker"]
    currency = sym.get("currency", "KRW")
    name = sym.get("name_ko") or sym.get("name_en") or ticker

    # 1) 과거 이력(증분 모드) → 기준일과 요청할 행수 결정.
    #    기준일 = 최근 REVISION_ROWS 거래일 바로 앞. 그 이후는 전부 다시 받아 덮어씁니다.
    hist = _load_history(ticker, full)
    if len(hist) > config.REVISION_ROWS:
        anchor_date = hist[-(config.REVISION_ROWS + 1)]["date"]
        target_rows = _rows_needed_since(anchor_date)
        mode = "증분"
    else:
        hist = []            # 이력이 워밍업에 못 미치면 전량 수집
        anchor_date = None
        target_rows = config.LOOKBACK_TRADING_DAYS
        mode = "전량"

    # 2) 일봉 수집
    candles, market = _fetch_candles(sym, target_rows)
    if not candles:
        print(f"  ✗ {ticker} {name}: 시세 없음")
        return False

    # 3) 이력 + 신규 병합(같은 날짜는 새로 받은 값이 우선)
    if hist:
        merged = {r["date"]: r for r in hist}
        merged.update({r["date"]: r for r in candles})
        rows = [merged[d] for d in sorted(merged)]
        write_dates = {r["date"] for r in candles if r["date"] > anchor_date}
    else:
        rows = candles
        write_dates = None  # 전량 = 전 구간 기록

    # 4) 지표
    df = indicators.compute(rows)
    if hist:
        _align_obv(ticker, df, anchor_date)

    # 5) 스코어링 (매크로가 매일 바뀌므로 새 거래일이 없어도 판정은 갱신)
    index_ret20 = macro.get("_kospi_ret20") if currency == "KRW" else None
    sig = scoring.score_signal(df, macro, market, currency, index_ret20)

    # 6) 업서트 — 증분이면 재검증 윈도우 이후만, 전량이면 전 구간
    write_df = df if write_dates is None else df[df["date"].isin(write_dates)]
    supabase_io.upsert("daily_prices", _price_rows(ticker, write_df), "ticker,trade_date")
    supabase_io.upsert("daily_indicators", _indicator_rows(ticker, write_df), "ticker,trade_date")

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

    written = len(write_df)
    detail = f"{written}행 기록" if written else "기록할 행 없음"
    print(f"  ✓ {ticker} {name}: {sig['zone']} ({sig['score']:+d}) · {trade_date} · {mode} {detail}")
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
    if "--prune" in argv:
        prune()
        return

    config.require_kis()
    config.require_supabase()

    full = "--full" in argv
    symbols = supabase_io.get_active_symbols()
    missing_only = "--missing" in argv
    tickers = [a for a in argv if not a.startswith("--")]

    # 시장 필터: 국내장/미국장이 닫힌 직후에 각각 따로 돌리기 위한 분리
    if "--kr" in argv:
        symbols = [s for s in symbols if s.get("currency", "KRW") == "KRW"]
        scope = "국내"
    elif "--us" in argv:
        symbols = [s for s in symbols if s.get("currency", "KRW") != "KRW"]
        scope = "해외"
    else:
        scope = "전체"
    if missing_only:
        # 아직 시세가 없는(새로 추가된) 종목만 처리
        have = supabase_io.get_signal_tickers()
        symbols = [s for s in symbols if s["ticker"] not in have]
    elif tickers:
        wanted = set(tickers)
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

    print(f"[2/2] {scope} 종목 {len(symbols)}개 처리… (모드: {'전량 재적재' if full else '증분'})")
    ok = fail = 0
    for sym in symbols:
        try:
            if process_symbol(sym, macro, full):
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
