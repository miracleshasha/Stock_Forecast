import { NextResponse } from "next/server";
import { getFreshness } from "@/lib/freshness";

export const dynamic = "force-dynamic";

/**
 * 상태 점검 — 외부 감시 서비스(UptimeRobot 등)가 주기적으로 부르는 용도.
 * 배치가 멈춰 데이터가 밀리면 503 을 돌려주므로, 감시 서비스의 장애 알림(메일·앱)으로 받을 수 있습니다.
 */
export async function GET() {
  const f = await getFreshness();
  if (f.stale) console.error(`[health] 배치 지연: 마지막 반영 ${f.lastDate}, 빠진 평일 ${f.missedDays}일`);
  return NextResponse.json(
    { ok: !f.stale, lastDate: f.lastDate, missedDays: f.missedDays },
    { status: f.stale ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
