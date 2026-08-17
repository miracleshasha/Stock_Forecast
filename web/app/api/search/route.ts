import { NextResponse } from "next/server";
import { searchSymbols } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  if (q.trim().length < 1) return NextResponse.json([]);
  const results = await searchSymbols(q, 8);
  return NextResponse.json(results);
}
