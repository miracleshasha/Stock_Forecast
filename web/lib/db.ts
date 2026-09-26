// ============================================================
// SignalDesk — data access layer (읽기 경로)
// 요청 시점에 계산하지 않는다. 배치가 채워둔 테이블에서 SELECT만.
// ============================================================

import { getSupabase } from "./supabase";
import type {
  ChartRange,
  ChartSeries,
  Indicators,
  Macro,
  Market,
  SearchResult,
  Signal,
  StockResponse,
  Symbol,
  Zone,
} from "./types";

function mapSymbol(row: Record<string, unknown>): Symbol {
  return {
    ticker: row.ticker as string,
    market: row.market as Market,
    nameKo: (row.name_ko as string) ?? null,
    nameEn: (row.name_en as string) ?? null,
    currency: (row.currency as "KRW" | "USD") ?? "KRW",
  };
}

function displayName(row: Record<string, unknown>): string {
  return (row.name_ko as string) || (row.name_en as string) || (row.ticker as string);
}

// ---------- 검색 (S-02) ----------
export async function searchSymbols(q: string, limit = 8): Promise<SearchResult[]> {
  const sb = getSupabase();
  if (!sb || q.trim().length < 1) return [];
  const term = q.trim();
  const pattern = `%${term}%`;

  const { data, error } = await sb
    .from("symbols")
    .select("ticker, market, name_ko, name_en, currency")
    .eq("is_active", true)
    .or(
      `name_ko.ilike.${pattern},name_en.ilike.${pattern},ticker.ilike.${pattern}`,
    )
    .limit(limit);

  if (error || !data) return [];

  const tickers = data.map((r) => r.ticker as string);
  const quotes = await getLatestQuotes(tickers);

  return data.map((r) => {
    const qt = quotes.get(r.ticker as string);
    return {
      ticker: r.ticker as string,
      name: displayName(r),
      market: r.market as Market,
      price: qt?.close ?? null,
      changePct: qt?.changePct ?? null,
    };
  });
}

interface Quote {
  close: number | null;
  change: number | null;
  changePct: number | null;
  asOf: string | null;
}

/** v_latest_quote 뷰에서 최신 시세 + 등락 조회 */
export async function getLatestQuotes(
  tickers: string[],
): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>();
  const sb = getSupabase();
  if (!sb || tickers.length === 0) return map;

  const { data } = await sb
    .from("v_latest_quote")
    .select("ticker, trade_date, close, change, change_pct")
    .in("ticker", tickers);

  for (const r of data ?? []) {
    map.set(r.ticker as string, {
      close: numOrNull(r.close),
      change: numOrNull(r.change),
      changePct: numOrNull(r.change_pct),
      asOf: (r.trade_date as string) ?? null,
    });
  }
  return map;
}

// ---------- 종목 헤더 + 시그널 (S-03) ----------
export async function getSymbol(ticker: string): Promise<Symbol | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("symbols")
    .select("ticker, market, name_ko, name_en, currency")
    .eq("ticker", ticker)
    .maybeSingle();
  return data ? mapSymbol(data) : null;
}

export async function getStock(ticker: string): Promise<StockResponse | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const symbol = await getSymbol(ticker);
  if (!symbol) return null;

  const [quotes, signalRow] = await Promise.all([
    getLatestQuotes([ticker]),
    sb
      .from("daily_signals")
      .select("score, zone, summary, breakdown, tags, trade_date")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const qt = quotes.get(ticker);
  const price = qt?.close != null
    ? {
        close: qt.close,
        change: qt.change ?? 0,
        changePct: qt.changePct ?? 0,
        asOf: qt.asOf ?? "",
      }
    : null;

  let signal: Signal | null = null;
  const sr = signalRow.data;
  if (sr) {
    signal = {
      score: Number(sr.score),
      zone: sr.zone as Zone,
      summary: (sr.summary as string) ?? "",
      breakdown: (sr.breakdown as Signal["breakdown"]) ?? {
        trend: 0, momentum: 0, band: 0, volume: 0, macro: 0,
      },
      tags: (sr.tags as string[]) ?? [],
      asOf: (sr.trade_date as string) ?? "",
    };
  }

  return { symbol, price, signal };
}

// ---------- 지표 상세 (S-05) ----------
/** 마지막으로 확정된 종가(배치가 채운 값). 장중 현재가의 신선도 판정에 씁니다. */
export async function getLastClose(ticker: string): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("daily_prices")
    .select("close")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.close) return null;
  return Number(data.close);
}

export async function getIndicators(ticker: string): Promise<Indicators | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("daily_indicators")
    .select("*")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    ma20: numOrNull(data.ma20),
    ma60: numOrNull(data.ma60),
    ma120: numOrNull(data.ma120),
    bbUpper: numOrNull(data.bb_upper),
    bbMid: numOrNull(data.bb_mid),
    bbLower: numOrNull(data.bb_lower),
    bbPercentB: numOrNull(data.bb_percent_b),
    bbWidth: numOrNull(data.bb_width),
    envUpper: numOrNull(data.env_upper),
    envLower: numOrNull(data.env_lower),
    rsi14: numOrNull(data.rsi14),
    macd: numOrNull(data.macd),
    macdSignal: numOrNull(data.macd_signal),
    macdHist: numOrNull(data.macd_hist),
    volRatio20: numOrNull(data.vol_ratio20),
    obv: numOrNull(data.obv),
  };
}

// ---------- 매크로 (S-05 / 홈) ----------
export async function getMacro(): Promise<Macro | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("daily_macro")
    .select("*")
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    vix: numOrNull(data.vix),
    vkospi: numOrNull(data.vkospi),
    us10y: numOrNull(data.us10y),
    dxy: numOrNull(data.dxy),
    usdkrw: numOrNull(data.usdkrw),
    kospiClose: numOrNull(data.kospi_close),
    spxClose: numOrNull(data.spx_close),
    asOf: (data.trade_date as string) ?? "",
  };
}

// ---------- 차트 (S-04) ----------
const RANGE_DAYS: Record<ChartRange, number> = { "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096 };

export async function getChart(
  ticker: string,
  range: ChartRange,
): Promise<ChartSeries> {
  const empty: ChartSeries = {
    candles: [], ma20: [], ma60: [], ma120: [],
    bbUpper: [], bbLower: [], bbMid: [], envUpper: [], envLower: [], volMa20: [],
  };
  const sb = getSupabase();
  if (!sb) return empty;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RANGE_DAYS[range]);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [pricesRes, indRes] = await Promise.all([
    sb
      .from("daily_prices")
      .select("trade_date, open, high, low, close, volume")
      .eq("ticker", ticker)
      .gte("trade_date", cutoffStr)
      .order("trade_date", { ascending: true }),
    sb
      .from("daily_indicators")
      .select("trade_date, ma20, ma60, ma120, bb_upper, bb_lower, bb_mid")
      .eq("ticker", ticker)
      .gte("trade_date", cutoffStr)
      .order("trade_date", { ascending: true }),
  ]);

  const prices = pricesRes.data ?? [];
  const inds = indRes.data ?? [];

  const series: ChartSeries = { ...empty, candles: [], ma20: [], ma60: [], ma120: [], bbUpper: [], bbLower: [], bbMid: [], envUpper: [], envLower: [], volMa20: [] };

  for (const p of prices) {
    series.candles.push({
      time: p.trade_date as string,
      open: Number(p.open),
      high: Number(p.high),
      low: Number(p.low),
      close: Number(p.close),
      volume: Number(p.volume),
    });
  }

  // 거래량 20일 이동평균 (표시용, 근사)
  for (let i = 0; i < series.candles.length; i++) {
    if (i >= 19) {
      let sum = 0;
      for (let j = i - 19; j <= i; j++) sum += series.candles[j].volume;
      series.volMa20.push({ time: series.candles[i].time, value: Math.round(sum / 20) });
    }
  }

  for (const d of inds) {
    const t = d.trade_date as string;
    push(series.ma20, t, d.ma20);
    push(series.ma60, t, d.ma60);
    push(series.ma120, t, d.ma120);
    push(series.bbUpper, t, d.bb_upper);
    push(series.bbLower, t, d.bb_lower);
    push(series.bbMid, t, d.bb_mid);
    // 엔벨로프 = MA20 × (1 ± 0.10)
    const mid = numOrNull(d.ma20);
    if (mid != null) {
      series.envUpper.push({ time: t, value: mid * 1.1 });
      series.envLower.push({ time: t, value: mid * 0.9 });
    }
  }

  return series;
}

// ---------- 즐겨찾기 목록 (S-06) ----------
export interface FavoriteRow {
  ticker: string;
  name: string;
  market: Market;
  currency: "KRW" | "USD";
  price: number | null;
  changePct: number | null;
  score: number | null;
  zone: Zone | null;
}

export async function getFavoriteRows(tickers: string[]): Promise<FavoriteRow[]> {
  const sb = getSupabase();
  if (!sb || tickers.length === 0) return [];

  const [symRes, sigRes, quotes] = await Promise.all([
    sb.from("symbols").select("ticker, market, name_ko, name_en, currency").in("ticker", tickers),
    latestSignals(tickers),
    getLatestQuotes(tickers),
  ]);

  const syms = symRes.data ?? [];
  return syms.map((r) => {
    const qt = quotes.get(r.ticker as string);
    const sig = sigRes.get(r.ticker as string);
    return {
      ticker: r.ticker as string,
      name: displayName(r),
      market: r.market as Market,
      currency: (r.currency as "KRW" | "USD") ?? "KRW",
      price: qt?.close ?? null,
      changePct: qt?.changePct ?? null,
      score: sig?.score ?? null,
      zone: sig?.zone ?? null,
    };
  });
}

const KR_MARKETS = new Set(["KOSPI", "KOSDAQ"]);
const regionOf = (market: string): "KR" | "US" => (KR_MARKETS.has(market) ? "KR" : "US");

// ---------- 종목 상세: 참고 정보 ----------
export interface StockExtras {
  high52: number | null;
  low52: number | null;
  /** 12-1개월 수익률(%) — 최근 1개월을 뺀 1년 수익률 */
  mom12: number | null;
  /** 같은 시장(국내/해외) 안에서의 백분위(0~1, 1이 가장 강함) */
  mom12Rank: number | null;
  peers: number;
  region: "KR" | "US";
}

/** 52주 범위와 12개월 흐름 순위. 판정 점수에는 들어가지 않는 참고 정보입니다.
 *  (factor_test.py 에서 12-1 모멘텀이 유일하게 앞/뒤 기간 모두 양의 IC를 보임) */
export async function getStockExtras(ticker: string, market: Market): Promise<StockExtras> {
  const region = regionOf(market);
  const out: StockExtras = { high52: null, low52: null, mom12: null, mom12Rank: null, peers: 0, region };
  const sb = getSupabase();
  if (!sb) return out;

  const { data: rows } = await sb
    .from("daily_prices")
    .select("trade_date, high, low, close")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(253);
  if (!rows || rows.length === 0) return out;

  const year = rows.slice(0, 252);
  out.high52 = Math.max(...year.map((r) => Number(r.high)));
  out.low52 = Math.min(...year.map((r) => Number(r.low)));
  if (rows.length < 253) return out;

  const dRecent = rows[21].trade_date as string;
  const dOld = rows[252].trade_date as string;
  out.mom12 = (Number(rows[21].close) / Number(rows[252].close) - 1) * 100;

  // 같은 두 날짜의 전 종목 종가 → 같은 시장 안 순위
  const [recentRes, oldRes, symRes] = await Promise.all([
    sb.from("daily_prices").select("ticker, close").eq("trade_date", dRecent).limit(5000),
    sb.from("daily_prices").select("ticker, close").eq("trade_date", dOld).limit(5000),
    sb.from("symbols").select("ticker, market").eq("is_active", true).limit(5000),
  ]);
  const inRegion = new Set(
    (symRes.data ?? []).filter((r) => regionOf(r.market as string) === region).map((r) => r.ticker as string),
  );
  const old = new Map((oldRes.data ?? []).map((r) => [r.ticker as string, Number(r.close)]));
  const rets: number[] = [];
  for (const r of recentRes.data ?? []) {
    const t = r.ticker as string;
    const o = old.get(t);
    if (!inRegion.has(t) || !o) continue;
    rets.push(Number(r.close) / o - 1);
  }
  if (rets.length >= 10) {
    const mine = out.mom12 / 100;
    const below = rets.filter((v) => v < mine).length;
    const equal = rets.filter((v) => v === mine).length;
    out.mom12Rank = (below + equal / 2) / rets.length;
    out.peers = rets.length;
  }
  return out;
}

async function latestSignals(
  tickers: string[],
): Promise<Map<string, { score: number; zone: Zone }>> {
  const map = new Map<string, { score: number; zone: Zone }>();
  const sb = getSupabase();
  if (!sb) return map;
  // v_latest_signal 뷰: ticker별 최신 시그널 1건
  const { data } = await sb
    .from("v_latest_signal")
    .select("ticker, score, zone")
    .in("ticker", tickers);
  for (const r of data ?? []) {
    map.set(r.ticker as string, { score: Number(r.score), zone: r.zone as Zone });
  }
  return map;
}

// ---------- utils ----------
function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function push(arr: { time: string; value: number }[], time: string, v: unknown) {
  const n = numOrNull(v);
  if (n != null) arr.push({ time, value: n });
}
