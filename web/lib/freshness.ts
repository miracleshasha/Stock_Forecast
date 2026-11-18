// ============================================================
// 데이터 신선도 (서버 전용) — 배치가 멈췄는지 화면·상태 점검 API 에 알립니다.
//
// 국내 배치(평일 18:30)가 넣는 daily_macro 의 마지막 날짜를 보고, 그 뒤로 빠진
// 평일 수를 셉니다. 오늘은 배치가 끝났을 시각(20:00 KST) 이후에만 셉니다.
// 공휴일은 모르기 때문에 하루 빠진 것은 휴장일 수 있어 2일 이상일 때만 지연으로 봅니다
// (3일 이상 연휴 직후에는 지연으로 잘못 보일 수 있습니다).
// ============================================================

import "server-only";
import { unstable_cache } from "next/cache";
import { getSupabase } from "./supabase";

const STALE_MISSED_DAYS = 2;
const BATCH_DONE_MIN = 20 * 60; // 20:00 KST

export type Freshness = { lastDate: string | null; missedDays: number; stale: boolean };

function kstNow(at: Date): { date: string; minutes: number } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

/** lastDate 다음 날부터 today 까지(오늘은 includeToday 일 때만) 평일 수 */
export function missedWeekdays(lastDate: string, today: string, includeToday: boolean): number {
  const day = 24 * 3600 * 1000;
  const end = Date.parse(`${today}T00:00:00Z`) + (includeToday ? day : 0);
  let n = 0;
  for (let t = Date.parse(`${lastDate}T00:00:00Z`) + day; t < end; t += day) {
    const w = new Date(t).getUTCDay();
    if (w !== 0 && w !== 6) n++;
  }
  return n;
}

const qLastMacroDate = unstable_cache(
  async (): Promise<string | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from("daily_macro")
      .select("trade_date")
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data?.trade_date as string) ?? null;
  },
  ["freshness-last-macro-v1"],
  { revalidate: 600 },
);

export async function getFreshness(at: Date = new Date()): Promise<Freshness> {
  const lastDate = await qLastMacroDate().catch(() => null);
  if (!lastDate) return { lastDate: null, missedDays: 0, stale: false };
  const now = kstNow(at);
  const missedDays = missedWeekdays(lastDate, now.date, now.minutes >= BATCH_DONE_MIN);
  return { lastDate, missedDays, stale: missedDays >= STALE_MISSED_DAYS };
}
