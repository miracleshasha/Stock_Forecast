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
