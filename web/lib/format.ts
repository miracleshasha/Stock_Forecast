// ============================================================
// SignalDesk — formatting & zone helpers
// 색상 규약: 상승 = 레드(up) / 하락 = 블루(down)
// ============================================================

import type { Currency, Market, Zone } from "./types";

export const ZONE_LABEL: Record<Zone, string> = {
  BUY: "매수 구간",
  BUY_LEAN: "매수 우위",
  NEUTRAL: "중립",
  SELL_LEAN: "매도 우위",
  SELL: "매도 구간",
  UNAVAILABLE: "판정 불가",
};

/** 게이지/텍스트 색상 클래스 (up=레드 강세, down=블루 약세) */
export function zoneTone(zone: Zone): "up" | "down" | "neu" {
  if (zone === "BUY" || zone === "BUY_LEAN") return "up";
  if (zone === "SELL" || zone === "SELL_LEAN") return "down";
  return "neu";
}

/** 등락 방향 → 색상 클래스 */
export function changeTone(change: number | null | undefined): "up" | "down" | "neu" {
  if (change == null || Math.abs(change) < 1e-9) return "neu";
  return change > 0 ? "up" : "down";
}

/** score(-100~+100) → 게이지 바늘 위치 % (0~100) */
export function scoreToPct(score: number): number {
  const clamped = Math.max(-100, Math.min(100, score));
  return ((clamped + 100) / 200) * 100;
}

export function scoreToZone(score: number): Zone {
  if (score >= 40) return "BUY";
  if (score >= 15) return "BUY_LEAN";
  if (score > -15) return "NEUTRAL";
  if (score > -40) return "SELL_LEAN";
  return "SELL";
}

const KRW = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatPrice(value: number | null | undefined, currency: Currency): string {
  if (value == null) return "—";
  return currency === "USD" ? `$${USD.format(value)}` : KRW.format(value);
}

export function formatChange(
  change: number | null | undefined,
  changePct: number | null | undefined,
  currency: Currency,
): string {
  if (change == null || changePct == null) return "—";
  const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "―";
  const abs = Math.abs(change);
  const amt = currency === "USD" ? `$${USD.format(abs)}` : KRW.format(abs);
  const pct = `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  return `${arrow} ${amt} (${pct})`;
}

export function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

export function formatNum(value: number | null | undefined, digits = 2): string {
  if (value == null) return "—";
  return value.toFixed(digits);
}

export const MARKET_LABEL: Record<Market, string> = {
  KOSPI: "KOSPI",
  KOSDAQ: "KOSDAQ",
  NASDAQ: "NASDAQ",
  NYSE: "NYSE",
};
