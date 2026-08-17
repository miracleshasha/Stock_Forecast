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

/** 초보자용 쉬운 설명 — 각 구간이 무슨 뜻인지 일상어로 */
export const ZONE_PLAIN: Record<Zone, string> = {
  BUY: "여러 지표가 '오를 힘'을 강하게 보여주고 있어요. 최근 흐름이 좋은 편이라 사는 쪽에 무게가 실리는 구간입니다.",
  BUY_LEAN: "'오를 힘'이 조금 더 우세해요. 아주 강하진 않지만 나쁘지 않은 흐름입니다.",
  NEUTRAL: "'오를 힘'과 '내릴 힘'이 팽팽해요. 아직 방향이 뚜렷하지 않아 서두르지 말고 지켜보기 좋은 구간입니다.",
  SELL_LEAN: "'내릴 힘'이 조금 더 우세해요. 조심스럽게 접근하는 게 좋은 구간입니다.",
  SELL: "여러 지표가 '내릴 힘'을 강하게 보여주고 있어요. 최근 흐름이 약한 편이라 파는 쪽에 무게가 실리는 구간입니다.",
  UNAVAILABLE: "데이터가 부족해 지금은 판정을 제공하지 않습니다.",
};

/** 점수를 일상어로 풀어주는 한 줄 */
export function scoreCaption(score: number): string {
  const dir = score > 0 ? "매수" : score < 0 ? "매도" : "중립";
  const strength = Math.abs(score) >= 40 ? "강한" : Math.abs(score) >= 15 ? "약한" : "";
  const label = score === 0 ? "중립" : `${strength} ${dir}`.trim();
  return `점수 ${score > 0 ? "+" : ""}${score} · −100(매도)에서 +100(매수) 사이예요. 지금은 ${label} 신호.`;
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
