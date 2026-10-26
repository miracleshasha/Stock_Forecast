import { NextResponse } from "next/server";
import { getTossStock } from "@/lib/toss";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  const stock = await getTossStock(ticker);
  if (!stock) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(stock);
}
