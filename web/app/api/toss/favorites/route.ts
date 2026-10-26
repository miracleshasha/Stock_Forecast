import { NextResponse } from "next/server";
import { FAVORITES_MAX, getTossFavorites } from "@/lib/toss";

export const dynamic = "force-dynamic";

/** GET /api/toss/favorites?t=005930,AAPL — 관심 종목은 미니앱 기기에 저장하고 목록만 넘겨받습니다 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("t") ?? "";
  const tickers = [...new Set(raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => /^[A-Z0-9.]{1,12}$/.test(s)))]
    .slice(0, FAVORITES_MAX);
  if (tickers.length === 0) return NextResponse.json({ items: [], missing: [] });
  const out = await getTossFavorites(tickers);
  if (!out) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(out);
}
