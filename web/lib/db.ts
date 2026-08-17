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
const RANGE_DAYS: Record<ChartRange, number> = { "3M": 92, "6M": 183, "1Y": 366, "3Y": 1096 };

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

// ---------- 홈: 오늘의 매수/매도 신호 ----------
export interface TopRow {
  ticker: string;
  name: string;
  market: Market;
  currency: "KRW" | "USD";
  score: number;
  zone: Zone;
  price: number | null;
  changePct: number | null;
}

export async function getTopSignals(
  limit = 5,
): Promise<{ buys: TopRow[]; sells: TopRow[] }> {
  const sb = getSupabase();
  if (!sb) return { buys: [], sells: [] };

  const [buyRes, sellRes] = await Promise.all([
    sb.from("v_latest_signal").select("ticker, score, zone").order("score", { ascending: false }).limit(limit),
    sb.from("v_latest_signal").select("ticker, score, zone").order("score", { ascending: true }).limit(limit),
  ]);
  const buys = buyRes.data ?? [];
  const sells = sellRes.data ?? [];
  const tickers = [...buys, ...sells].map((r) => r.ticker as string);
  if (tickers.length === 0) return { buys: [], sells: [] };

  const [symRes, quotes] = await Promise.all([
    sb.from("symbols").select("ticker, market, name_ko, name_en, currency").in("ticker", tickers),
    getLatestQuotes(tickers),
  ]);
  const symMap = new Map((symRes.data ?? []).map((r) => [r.ticker as string, r]));

  const build = (rows: { ticker: string; score: number; zone: string }[]): TopRow[] =>
    rows.map((r) => {
      const s = symMap.get(r.ticker);
      const qt = quotes.get(r.ticker);
      return {
        ticker: r.ticker,
        name: s ? displayName(s) : r.ticker,
        market: (s?.market as Market) ?? "KOSPI",
        currency: ((s?.currency as "KRW" | "USD") ?? "KRW"),
        score: Number(r.score),
        zone: r.zone as Zone,
        price: qt?.close ?? null,
        changePct: qt?.changePct ?? null,
      };
    });

  return { buys: build(buys as never), sells: build(sells as never) };
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
