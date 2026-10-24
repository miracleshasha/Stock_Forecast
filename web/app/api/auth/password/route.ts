import { NextResponse } from "next/server";
import { changePassword } from "@/lib/auth";
import { PASSWORD_MIN } from "@/lib/phone";
import { respond } from "../_shared";

/** 비밀번호 변경. JSON 요청만 받습니다(다른 사이트의 폼 전송 차단). */
export async function POST(req: Request) {
  if (!req.headers.get("content-type")?.includes("application/json")) {
    return NextResponse.json({ message: "잘못된 요청이에요." }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { current?: unknown; next?: unknown } | null;
  const current = typeof body?.current === "string" ? body.current : "";
  const next = typeof body?.next === "string" ? body.next : "";
  if (!current) return NextResponse.json({ message: "현재 비밀번호를 입력해 주세요." }, { status: 400 });
  if (next.length < PASSWORD_MIN || next.length > 72) {
    return NextResponse.json({ message: `새 비밀번호는 ${PASSWORD_MIN}자 이상으로 해주세요.` }, { status: 400 });
  }
  return respond(await changePassword(current, next));
}
