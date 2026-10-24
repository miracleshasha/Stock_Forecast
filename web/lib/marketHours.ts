// ============================================================
// SignalDesk — 장 운영시간 판단
// 현재가를 실시간으로 조회할지, 확정 종가를 그대로 쓸지 가릅니다.
// 장이 닫혀 있으면 KIS를 호출하지 않습니다(호출 낭비 방지).
// ============================================================

import type { Currency } from "./types";

/** 특정 타임존 기준의 요일(0=일)·분 단위 시각 */
function zoned(tz: string, at: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const day = DAYS.indexOf(get("weekday"));
  // 자정은 환경에 따라 "24"로 나오는 경우가 있어 24 → 0 으로 정규화
  const hour = Number(get("hour")) % 24;
  return { day, minutes: hour * 60 + Number(get("minute")) };
}

function inSession(
  tz: string,
  openMin: number,
  closeMin: number,
  at: Date,
): boolean {
  const { day, minutes } = zoned(tz, at);
  if (day === 0 || day === 6) return false; // 주말
  return minutes >= openMin && minutes <= closeMin;
}

/**
 * 장중 여부. 공휴일은 판별하지 않습니다 — 휴장일에 조회하면 KIS가 직전 종가를
 * 그대로 돌려주므로 값이 틀리지는 않고, 호출 몇 번이 낭비될 뿐입니다.
 * 서머타임은 타임존 계산이 알아서 처리합니다(미국장은 현지 09:30~16:00 고정).
 */
export function isMarketOpen(currency: Currency, at: Date = new Date()): boolean {
  if (currency === "KRW") {
    return inSession("Asia/Seoul", 9 * 60, 15 * 60 + 30, at); // 09:00~15:30 KST
  }
  return inSession("America/New_York", 9 * 60 + 30, 16 * 60, at); // 09:30~16:00 ET
}

// ---------- 장 단계 (2026-10: 장 마감 후 '오늘 종가' 표시용) ----------
export type MarketPhase = "open" | "after_close" | "closed";

const SESSION: Record<Currency, { tz: string; open: number; close: number }> = {
  KRW: { tz: "Asia/Seoul", open: 9 * 60, close: 15 * 60 + 30 },
  USD: { tz: "America/New_York", open: 9 * 60 + 30, close: 16 * 60 },
};

/**
 * open = 장중, after_close = 평일 장 마감 뒤 같은 날(현지) 자정까지, closed = 그 외(장 전·주말).
 * after_close 동안은 '오늘 종가'를 보여주고, 배치가 오늘 종가를 DB 에 넣으면 그 값을 씁니다.
 */
export function marketPhase(currency: Currency, at: Date = new Date()): MarketPhase {
  const s = SESSION[currency];
  const { day, minutes } = zoned(s.tz, at);
  if (day === 0 || day === 6) return "closed";
  if (minutes >= s.open && minutes <= s.close) return "open";
  if (minutes > s.close) return "after_close";
  return "closed";
}

/** 그 시장 현지 기준 오늘 날짜(YYYY-MM-DD) */
export function marketToday(currency: Currency, at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SESSION[currency].tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
