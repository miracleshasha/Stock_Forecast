// ============================================================
// 장중 현재가 (서버 전용) — 종목 화면 첫 렌더와 /api/stock/[ticker]/quote 가 함께 씁니다.
//
// live_quotes 를 TTL(기본 60초) 캐시로 써서, 새로고침을 반복해도 KIS 호출이
// 종목당 분당 1회를 넘지 않습니다. 장이 닫혀 있으면 아예 호출하지 않습니다.
// 판정 점수는 건드리지 않고 화면 상단 숫자에만 쓰입니다.
// ============================================================

import "server-only";
import { getLastClose } from "./db";
import { fetchQuote, isKisConfigured } from "./kis";
import { isMarketOpen } from "./marketHours";
import { getSupabase } from "./supabase";
import type { LiveQuote, QuoteResponse, QuoteSkipReason, Symbol } from "./types";

const TTL_MS = Number(process.env.QUOTE_TTL_SECONDS ?? 60) * 1000;

const closed = (marketOpen: boolean, reason: QuoteSkipReason): QuoteResponse => ({
  live: false,
  marketOpen,
  quote: null,
  reason,
});

/**
 * @param lastClose DB 의 마지막 확정 종가. 호출자가 이미 알고 있으면 넘겨서 조회를 한 번 줄입니다.
 */
export async function getLiveQuote(symbol: Symbol, lastClose?: number | null): Promise<QuoteResponse> {
  const sb = getSupabase();
  if (!sb) return closed(false, "supabase_missing");
  if (!isKisConfigured()) return closed(false, "kis_not_configured");

  const marketOpen = isMarketOpen(symbol.currency);
  if (!marketOpen) return closed(false, "market_closed");

  // 거래가 없는 세션(공휴일 등) 판정용 기준값.
  //   isMarketOpen 은 시계만 보므로 공휴일(예: 미국 Labor Day)에도 개장으로 봅니다.
  //   그런 날 KIS는 "현재가"로 직전 세션의 종가를 그대로 돌려주는데, 그걸 실시간이라
  //   표시하면 오해를 부릅니다. 거래가 있는 날이라면 현재가는 DB의 마지막 확정
  //   종가(=전일 종가)와 다르므로, 같으면 거래 없는 세션으로 보고 종가 표시로 넘깁니다.
  //   (현재가가 전일 종가와 정확히 일치하는 순간에도 종가로 표시되지만, 틀린 값을
  //    실시간이라 주장하는 것보다 안전한 실패입니다.)
  const base = lastClose !== undefined ? lastClose : await getLastClose(symbol.ticker);
  const noTrading = (price: number) => base != null && Math.abs(price - base) < 1e-9;

  // 1) 캐시 확인
  const { data: cached } = await sb
    .from("live_quotes")
    .select("price, prev_close, change, change_pct, fetched_at")
    .eq("ticker", symbol.ticker)
    .maybeSingle();

  if (cached?.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at as string).getTime();
    if (age >= 0 && age < TTL_MS && cached.price != null && !noTrading(Number(cached.price))) {
      const quote: LiveQuote = {
        price: Number(cached.price),
        prevClose: cached.prev_close != null ? Number(cached.prev_close) : null,
        change: Number(cached.change ?? 0),
        changePct: Number(cached.change_pct ?? 0),
        fetchedAt: cached.fetched_at as string,
      };
      return { live: true, marketOpen, quote };
    }
  }

  // 2) KIS 조회
  const { quote, reason } = await fetchQuote(symbol.ticker, symbol.market, symbol.currency);
  if (!quote) return closed(marketOpen, reason ?? "kis_failed");

  // 2-1) 거래 없는 세션이면 종가 표시로 넘깁니다(캐시에 남기지도 않습니다).
  if (noTrading(quote.price)) return closed(marketOpen, "no_trading");

  // 3) 캐시 갱신 (실패해도 응답에는 영향 없음)
  await sb
    .from("live_quotes")
    .upsert(
      {
        ticker: symbol.ticker,
        price: quote.price,
        prev_close: quote.prevClose,
        change: quote.change,
        change_pct: quote.changePct,
        fetched_at: quote.fetchedAt,
      },
      { onConflict: "ticker" },
    )
    .then(undefined, () => undefined);

  return { live: true, marketOpen, quote };
}

/**
 * 종목 화면 첫 렌더용. 장중일 때만 현재가를 받아오되, 화면 전체가 KIS 응답을
 * 기다리지 않도록 상한(기본 2.5초)을 둡니다. 시간 안에 못 받으면 null →
 * 화면은 종가로 먼저 뜨고 브라우저가 이어서 받아옵니다.
 */
export async function getInitialQuote(
  symbol: Symbol,
  lastClose: number | null,
  timeoutMs = 2500,
): Promise<QuoteResponse | null> {
  if (!isMarketOpen(symbol.currency)) return null; // 장 마감: 조회 자체를 안 함
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    return await Promise.race([getLiveQuote(symbol, lastClose), timeout]);
  } catch (e) {
    console.warn(`[liveQuote] ${symbol.ticker} 첫 조회 실패 — 브라우저에서 다시 받습니다`, e);
    return null;
  }
}
