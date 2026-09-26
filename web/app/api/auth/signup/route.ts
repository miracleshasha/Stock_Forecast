import { NextResponse } from "next/server";
import { signUp } from "@/lib/auth";
import { readCredentials, respond } from "../_shared";

export async function POST(req: Request) {
  const cred = await readCredentials(req);
  if (cred instanceof NextResponse) return cred;
  return respond(await signUp(cred.phone, cred.password));
}
