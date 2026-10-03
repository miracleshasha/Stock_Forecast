// ============================================================
// 장중 현재가 API — 종목 화면이 1분마다 갱신할 때 씁니다.
// 실제 로직(캐시·KIS 조회·휴장 판정)은 lib/liveQuote.ts 에 있습니다.
// ============================================================

import { NextResponse } from "next/server";
import { getSymbol } from "@/lib/db";
import { getLiveQuote } from "@/lib/liveQuote";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  const symbol = await getSymbol(ticker);
  if (!symbol) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(await getLiveQuote(symbol));
}
