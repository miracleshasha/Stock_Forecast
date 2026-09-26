import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { FAVORITES_MAX, addFavorite, listFavorites, removeFavorite } from "@/lib/userFavorites";
import type { Market } from "@/lib/types";

export const dynamic = "force-dynamic";

const unauthorized = () => NextResponse.json({ message: "로그인이 필요해요." }, { status: 401 });

export async function GET() {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  return NextResponse.json(await listFavorites(user.id));
}

/** { ticker, market } 추가 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const body = (await req.json().catch(() => null)) as { ticker?: unknown; market?: unknown } | null;
  const ticker = typeof body?.ticker === "string" ? body.ticker.trim() : "";
  const market = typeof body?.market === "string" ? body.market : "";
  // AMEX 등 목록 밖 시장도 symbols 에 있으면 허용 — 타입만 문자열로 확인
  if (!ticker || ticker.length > 20 || !market) {
    return NextResponse.json({ message: "잘못된 요청이에요." }, { status: 400 });
  }
  const result = await addFavorite(user.id, ticker, market as Market);
  if (result === "full") {
    return NextResponse.json({ message: `즐겨찾기는 ${FAVORITES_MAX}개까지 담을 수 있어요.` }, { status: 409 });
  }
  if (result === "unknown_ticker") {
    return NextResponse.json({ message: "지원하지 않는 종목이에요." }, { status: 400 });
  }
  return NextResponse.json(await listFavorites(user.id));
}

/** ?ticker= 삭제 */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return unauthorized();
  const ticker = new URL(req.url).searchParams.get("ticker")?.trim();
  if (!ticker) return NextResponse.json({ message: "잘못된 요청이에요." }, { status: 400 });
  await removeFavorite(user.id, ticker);
  return NextResponse.json(await listFavorites(user.id));
}

