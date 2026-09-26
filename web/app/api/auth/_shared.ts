import { NextResponse } from "next/server";
import { writeSessionCookies, type AuthResult } from "@/lib/auth";
import { PASSWORD_MIN, isValidPhone } from "@/lib/phone";

/** 폼 대신 JSON 요청만 받습니다(다른 사이트의 폼 전송으로 로그인시키는 CSRF 차단). */
export async function readCredentials(
  req: Request,
): Promise<{ phone: string; password: string } | NextResponse> {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ message: "잘못된 요청이에요." }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { phone?: unknown; password?: unknown } | null;
  const phone = typeof body?.phone === "string" ? body.phone : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (!isValidPhone(phone)) {
    return NextResponse.json({ message: "휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)" }, { status: 400 });
  }
  if (password.length < PASSWORD_MIN || password.length > 72) {
    return NextResponse.json({ message: `비밀번호는 ${PASSWORD_MIN}자 이상으로 해주세요.` }, { status: 400 });
  }
  return { phone, password };
}

export function respond(result: AuthResult): NextResponse {
  if (!result.ok) return NextResponse.json({ message: result.message }, { status: result.status });
  const res = NextResponse.json({ ok: true });
  writeSessionCookies(res.cookies, result.session);
  return res;
}
