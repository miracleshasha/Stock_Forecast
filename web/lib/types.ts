// ============================================================
// SignalDesk — shared types
// ============================================================

export type Market = "KOSPI" | "KOSDAQ" | "NASDAQ" | "NYSE" | "AMEX";
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
  /** 'etf' 면 화면에 ETF 표시 (symbols.kind, 2026-10 추가) */
  kind?: "stock" | "etf";
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

/** 장중 현재가. 판정 점수와 달리 확정 일봉이 아니라 실시간 값입니다. */
export interface LiveQuote {
  price: number;
  prevClose: number | null;
  change: number;
  changePct: number;
  fetchedAt: string; // ISO8601
}

/** live=false 인 이유. 배포 환경에서 로그를 못 볼 때 원인을 바로 알기 위한 값입니다. */
export type QuoteSkipReason =
  | "market_closed"      // 장 시간이 아님 (정상)
  | "no_trading"         // 시계상 장중이나 거래 없는 세션(공휴일 등)
  | "supabase_missing"   // Supabase 환경변수 없음
  | "kis_not_configured" // KIS_APP_KEY / KIS_APP_SECRET 없음
  | "no_token"           // kis_token 을 못 읽음(미발급·만료·권한)
  | "kis_failed";        // KIS 호출 실패(오류·타임아웃)

export interface QuoteResponse {
  /** 실시간 값인지 여부. false면 화면은 확정 종가를 그대로 씁니다. */
  live: boolean;
  marketOpen: boolean;
  quote: LiveQuote | null;
  reason?: QuoteSkipReason;
  /** open = 장중 실시간, after_close = 장 마감 후 배치 전 '오늘 종가' */
  phase?: "open" | "after_close";
  /** after_close 일 때 그 시장 현지 기준 오늘 날짜(YYYY-MM-DD) */
  sessionDate?: string;
}

/** breakdown: 그룹별 획득 점수 (-100~+100 정규화 기준 기여도) */
export interface SignalBreakdown {
  trend: number;
  momentum: number;
  band: number;
  volume: number;
  /** 방향 기여 없음(항상 0). 매크로는 2026-09부터 확신도 감쇠로만 쓰입니다 */
  macro: number;
  /** 지수 대비 20일 상대강도(%p). 모멘텀 그룹의 근거 표시용 */
  rs20?: number | null;
  /** 시장 불안정에 따른 확신도 배수(0.5~1.0). 1 미만이면 판정을 중립 쪽으로 당겼다는 뜻 */
  damp?: number | null;
}

export interface Signal {
  score: number; // -100 ~ +100
  zone: Zone;
  summary: string;
  breakdown: SignalBreakdown;
  tags: string[];
  asOf: string;
  /** 단기 신호(캔들 패턴·가격위치×거래량). 판정 점수와 별개. 배치 batch/patterns.py */
  shortTerm: ShortTerm | null;
}

export interface ShortTermPattern {
  key: string;
  name: string;
  /** 교과서상 방향: 1 상승, -1 하락, 0 중립 */
  dir: number;
  desc: string;
}

export interface ShortTerm {
  label: string;
  tone: number;
  patterns: ShortTermPattern[];
}

/** 패턴 실측(batch/pattern_backtest.py) — 다음 5거래일 수익률을 같은 시장 아무 날과 비교 */
export interface PatternStat {
  pattern: string;
  n: number;
  nDays: number;
  ret5: number;
  baseRet5: number;
  win5: number;
  baseWin5: number;
  excess5: number;
  se5: number | null;
  periodFrom: string | null;
  periodTo: string | null;
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

export type ChartRange = "1M" | "3M" | "6M" | "1Y" | "3Y";

export interface FavoriteItem {
  ticker: string;
  market: Market;
  addedAt: number;
}

/** N일 뒤 전망 (batch/direction_model.py) — 한 기간(5·10·20거래일) */
export interface OutlookHorizon {
  h: number;
  /** N거래일 뒤 종가가 오늘보다 높을 확률(0~1). 모델이 꺼진 기간이면 base 와 같음 */
  p: number;
  /** 같은 시장 종목이 N거래일 뒤 오른 평균 비율 */
  base: number;
  /** N거래일 뒤 수익률 10%·50%·90% 분위(소수, 예: -0.05) — lo~hi 가 80% 구간 */
  lo: number | null;
  mid: number | null;
  hi: number | null;
  /** 모델이 켜진 기간만: [피처, 로짓 기여, 피처 수준 부호] */
  drivers: [string, number, number][];
  /** 이 기간 방향 모델이 검증을 통과해 켜져 있는지 */
  enabled: boolean;
  /** 워크포워드 검증 성적 */
  wf: { skill: number; skillSe: number; csAuc: number | null; from: string; to: string } | null;
  rangeWf: { coverage: number; pinballSkill: number } | null;
}

export interface Outlook {
  asOf: string;
  horizons: OutlookHorizon[];
}
