// ============================================================
// 장중 현재가. 판정 점수는 건드리지 않고 화면 상단 숫자에만 쓰입니다.
//
// live_quotes 를 TTL(기본 60초) 캐시로 써서, 새로고침을 반복해도 KIS 호출이
// 종목당 분당 1회를 넘지 않습니다. 장이 닫혀 있으면 아예 호출하지 않습니다.
// ============================================================

import { NextResponse } from "next/server";
import { getLastClose, getSymbol } from "@/lib/db";
import { fetchQuote, isKisConfigured } from "@/lib/kis";
import { isMarketOpen } from "@/lib/marketHours";
import { getSupabase } from "@/lib/supabase";
import type { LiveQuote, QuoteResponse, QuoteSkipReason } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = Number(process.env.QUOTE_TTL_SECONDS ?? 60) * 1000;

function closed(marketOpen: boolean, reason: QuoteSkipReason): NextResponse {
  const body: QuoteResponse = { live: false, marketOpen, quote: null, reason };
  return NextResponse.json(body);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;

  const sb = getSupabase();
  if (!sb) return closed(false, "supabase_missing");
  if (!isKisConfigured()) return closed(false, "kis_not_configured");

  const symbol = await getSymbol(ticker);
  if (!symbol) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const marketOpen = isMarketOpen(symbol.currency);
  if (!marketOpen) return closed(false, "market_closed");

  // 거래가 없는 세션(공휴일 등) 판정용 기준값.
  //   isMarketOpen 은 시계만 보므로 공휴일(예: 미국 Labor Day)에도 개장으로 봅니다.
  //   그런 날 KIS는 "현재가"로 직전 세션의 종가를 그대로 돌려주는데, 그걸 실시간이라
  //   표시하면 오해를 부릅니다. 거래가 있는 날이라면 현재가는 DB의 마지막 확정
  //   종가(=전일 종가)와 다르므로, 같으면 거래 없는 세션으로 보고 종가 표시로 넘깁니다.
  //   (현재가가 전일 종가와 정확히 일치하는 순간에도 종가로 표시되지만, 틀린 값을
  //    실시간이라 주장하는 것보다 안전한 실패입니다.)
  const lastClose = await getLastClose(symbol.ticker);
  const noTrading = (price: number) =>
    lastClose != null && Math.abs(price - lastClose) < 1e-9;

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
      return NextResponse.json({ live: true, marketOpen, quote } satisfies QuoteResponse);
    }
  }

  // 2) KIS 조회
  const { quote, reason } = await fetchQuote(
    symbol.ticker,
    symbol.market,
    symbol.currency,
  );
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

  return NextResponse.json({ live: true, marketOpen, quote } satisfies QuoteResponse);
}
