import { NextResponse } from "next/server";
import { getChart } from "@/lib/db";
import type { ChartRange } from "@/lib/types";

export const dynamic = "force-dynamic";

const VALID: ChartRange[] = ["3M", "6M", "1Y", "3Y"];

export async function GET(
  req: Request,
  ctx: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await ctx.params;
  const { searchParams } = new URL(req.url);
  const raw = (searchParams.get("range") ?? "6M") as ChartRange;
  const range = VALID.includes(raw) ? raw : "6M";
  const series = await getChart(ticker, range);
  return NextResponse.json(series);
}
