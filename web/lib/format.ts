// ============================================================
// SignalDesk — formatting & zone helpers
// 색상 규약: 상승 = 레드(up) / 하락 = 블루(down)
// ============================================================

import type { Currency, Market, Zone } from "./types";

// 판정 문구는 "사라/팔아라"가 아니라 지금 차트 상태를 설명합니다.
// 백테스트(2026-09)에서 이 점수의 미래 수익 예측력이 확인되지 않았기 때문입니다.
export const ZONE_LABEL: Record<Zone, string> = {
  BUY: "상승 흐름",
  BUY_LEAN: "약한 상승 흐름",
  NEUTRAL: "방향 탐색 중",
  SELL_LEAN: "약한 하락 흐름",
  SELL: "하락 흐름",
  UNAVAILABLE: "판정 보류",
};

/** 초보자용 쉬운 설명 — 각 구간이 무슨 뜻인지 일상어로 */
export const ZONE_PLAIN: Record<Zone, string> = {
  BUY: "여러 지표가 함께 오르는 쪽을 가리키고 있어요.",
  BUY_LEAN: "오르는 쪽 신호가 조금 더 많지만 아주 강하진 않아요.",
  NEUTRAL: "오르는 신호와 내리는 신호가 비슷해 방향이 뚜렷하지 않아요.",
  SELL_LEAN: "내리는 쪽 신호가 조금 더 많지만 아주 강하진 않아요.",
  SELL: "여러 지표가 함께 내리는 쪽을 가리키고 있어요.",
  UNAVAILABLE: "데이터가 부족해 지금은 판정하지 않아요.",
};

export function formatScore(score: number): string {
  return score > 0 ? `+${score}` : `${score}`;
}

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
  return currency === "USD" ? `$${USD.format(value)}` : `${KRW.format(value)}원`;
}

/** "+10,000원 (+3.62%)" / "-$3.48 (-1.04%)" */
export function formatChange(
  change: number | null | undefined,
  changePct: number | null | undefined,
  currency: Currency,
): string {
  if (change == null || changePct == null) return "—";
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  const abs = Math.abs(change);
  const amt = currency === "USD" ? `$${USD.format(abs)}` : `${KRW.format(abs)}원`;
  const pct = `${changePct > 0 ? "+" : ""}${changePct.toFixed(2)}%`;
  return `${sign}${amt} (${pct})`;
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
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  NASDAQ: "나스닥",
  NYSE: "뉴욕",
};

/** "2026-09-23" → "9월 23일" */
export function formatDateKo(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${Number(m[1])}월 ${Number(m[2])}일` : iso;
}

/** 목록 아바타용 첫 글자 */
export function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

/** 백만원 단위 금액 → "+1.28조" / "-5,044억" / "+38억" */
export function formatWonMillion(mil: number, signed = true): string {
  const sign = signed ? (mil > 0 ? "+" : mil < 0 ? "-" : "") : mil < 0 ? "-" : "";
  const a = Math.abs(mil);
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}조`;
  if (a >= 100) return `${sign}${Math.round(a / 100).toLocaleString("ko-KR")}억`;
  return `${sign}${Math.round(a).toLocaleString("ko-KR")}백만`;
}
