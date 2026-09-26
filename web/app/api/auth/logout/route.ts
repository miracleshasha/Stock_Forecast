import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, clearSessionCookies, revoke } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(COOKIE.access)?.value;
  if (token) await revoke(token);
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res.cookies);
  return res;
}
