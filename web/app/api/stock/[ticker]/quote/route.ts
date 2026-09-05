// ============================================================
// 장중 현재가. 판정 점수는 건드리지 않고 화면 상단 숫자에만 쓰입니다.
//
// live_quotes 를 TTL(기본 60초) 캐시로 써서, 새로고침을 반복해도 KIS 호출이
// 종목당 분당 1회를 넘지 않습니다. 장이 닫혀 있으면 아예 호출하지 않습니다.
// ============================================================

import { NextResponse } from "next/server";
import { getSymbol } from "@/lib/db";
import { fetchQuote, isKisConfigured } from "@/lib/kis";
import { isMarketOpen } from "@/lib/marketHours";
import { getSupabase } from "@/lib/supabase";
import type { LiveQuote, QuoteResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

const TTL_MS = Number(process.env.QUOTE_TTL_SECONDS ?? 60) * 1000;

function closed(marketOpen = false): NextResponse {
  const body: QuoteResponse = { live: false, marketOpen, quote: null };
  return NextResponse.json(body);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;

  const sb = getSupabase();
  if (!sb || !isKisConfigured()) return closed();

  const symbol = await getSymbol(ticker);
  if (!symbol) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const marketOpen = isMarketOpen(symbol.currency);
  if (!marketOpen) return closed(false);

  // 1) 캐시 확인
  const { data: cached } = await sb
    .from("live_quotes")
    .select("price, prev_close, change, change_pct, fetched_at")
    .eq("ticker", symbol.ticker)
    .maybeSingle();

  if (cached?.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at as string).getTime();
    if (age >= 0 && age < TTL_MS && cached.price != null) {
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
  const quote = await fetchQuote(symbol.ticker, symbol.market, symbol.currency);
  if (!quote) return closed(marketOpen);

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
