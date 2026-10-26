import { NextResponse } from "next/server";
import { signInWithPhone } from "@/lib/auth";
import { readPhone, respond } from "../_shared";

/** 전화번호만으로 들어가기(처음이면 계정 생성) */
export async function POST(req: Request) {
  const cred = await readPhone(req);
  if (cred instanceof NextResponse) return cred;
  return respond(await signInWithPhone(cred.phone, cred.password));
}
