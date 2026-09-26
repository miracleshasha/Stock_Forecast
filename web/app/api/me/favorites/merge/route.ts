import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { mergeFavorites } from "@/lib/userFavorites";
import type { FavoriteItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/** { items: FavoriteItem[] } — 브라우저에 있던 즐겨찾기를 계정으로 합치고 최종 목록을 돌려줍니다 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ message: "로그인이 필요해요." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const items = (Array.isArray(body?.items) ? body.items : [])
    .filter(
      (x): x is FavoriteItem =>
        !!x && typeof x.ticker === "string" && typeof x.market === "string" && x.ticker.length <= 20,
    )
    .map((x) => ({ ticker: x.ticker, market: x.market, addedAt: Number(x.addedAt) || Date.now() }))
    .slice(0, 50);
  return NextResponse.json(await mergeFavorites(user.id, items));
}
