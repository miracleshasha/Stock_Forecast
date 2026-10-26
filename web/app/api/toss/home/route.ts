import { NextResponse } from "next/server";
import { getTossHome } from "@/lib/toss";

export const dynamic = "force-dynamic";

export async function GET() {
  const home = await getTossHome();
  if (!home) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  return NextResponse.json(home);
}
