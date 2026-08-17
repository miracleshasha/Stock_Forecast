import { NextResponse } from "next/server";
import { getFavoriteRows } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("tickers") ?? "";
  const tickers = raw.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 20);
  if (tickers.length === 0) return NextResponse.json([]);
  const rows = await getFavoriteRows(tickers);
  return NextResponse.json(rows);
}
