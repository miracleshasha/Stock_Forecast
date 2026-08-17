import { NextResponse } from "next/server";
import { getStock } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  const stock = await getStock(ticker);
  if (!stock) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(stock);
}
