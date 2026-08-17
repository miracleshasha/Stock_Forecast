import { NextResponse } from "next/server";
import { getMacro } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const macro = await getMacro();
  return NextResponse.json(macro);
}
