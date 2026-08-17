// ============================================================
// SignalDesk — shared types
// ============================================================

export type Market = "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE";
export type Currency = "KRW" | "USD";

export type Zone =
  | "BUY"
  | "BUY_LEAN"
  | "NEUTRAL"
  | "SELL_LEAN"
  | "SELL"
  | "UNAVAILABLE";

export interface Symbol {
  ticker: string;
  market: Market;
  nameKo: string | null;
  nameEn: string | null;
  currency: Currency;
}

export interface SearchResult {
  ticker: string;
  name: string;
  market: Market;
  price: number | null;
  changePct: number | null;
}

export interface PriceInfo {
  close: number;
  change: number;
  changePct: number;
  asOf: string; // YYYY-MM-DD
}

/** breakdown: 그룹별 획득 점수 (-100~+100 정규화 기준 기여도) */
export interface SignalBreakdown {
  trend: number;
  momentum: number;
  band: number;
  volume: number;
  macro: number;
  /** 지수 대비 20일 상대강도(%p). 매크로 점수 근거 표시용 */
  rs20?: number | null;
}

export interface Signal {
  score: number; // -100 ~ +100
  zone: Zone;
  summary: string;
  breakdown: SignalBreakdown;
  tags: string[];
  asOf: string;
}

export interface StockResponse {
  symbol: Symbol;
  price: PriceInfo | null;
  signal: Signal | null;
}

/** 지표 상세 (S-05 근거 패널) */
export interface Indicators {
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  bbUpper: number | null;
  bbMid: number | null;
  bbLower: number | null;
  bbPercentB: number | null;
  bbWidth: number | null;
  envUpper: number | null;
  envLower: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  volRatio20: number | null;
  obv: number | null;
}

export interface Macro {
  vix: number | null;
  vkospi: number | null;
  us10y: number | null;
  dxy: number | null;
  usdkrw: number | null;
  kospiClose: number | null;
  spxClose: number | null;
  asOf: string;
}

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ChartSeries {
  candles: Candle[];
  ma20: { time: string; value: number }[];
  ma60: { time: string; value: number }[];
  ma120: { time: string; value: number }[];
  bbUpper: { time: string; value: number }[];
  bbLower: { time: string; value: number }[];
  bbMid: { time: string; value: number }[];
  envUpper: { time: string; value: number }[];
  envLower: { time: string; value: number }[];
  volMa20: { time: string; value: number }[];
}

export type ChartRange = "3M" | "6M" | "1Y" | "3Y";

export interface FavoriteItem {
  ticker: string;
  market: Market;
  addedAt: number;
}
