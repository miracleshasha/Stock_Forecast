// ============================================================
// SignalDesk — data access layer (읽기 경로)
// 요청 시점에 계산하지 않는다. 배치가 채워둔 테이블에서 SELECT만.
// ============================================================

import { unstable_cache } from "next/cache";
import { bbEventsOf, getHomeStatRows, type BbEvent } from "./home";
import { getSupabase } from "./supabase";
import type {
  ChartRange,
  ChartSeries,
  Indicators,
  Macro,
  Market,
  Outlook,
  OutlookHorizon,
  PatternStat,
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
    kind: row.kind === "etf" ? "etf" : "stock",
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

/**
 * 최신 시세 + 등락. 먼저 mv_home_stats 캐시(5분)에서 찾고, 없는 종목만 v_latest_quote 뷰로 조회합니다.
 * (뷰는 종목마다 전 기간을 읽어서 여러 종목을 물으면 DB에서만 0.5초 넘게 걸렸음)
 */
export async function getLatestQuotes(
  tickers: string[],
): Promise<Map<string, Quote>> {
  const map = new Map<string, Quote>();
  if (tickers.length === 0) return map;

  const want = new Set(tickers);
  for (const r of await getHomeStatRows().catch(() => [])) {
    if (!want.has(r.ticker as string)) continue;
    const close = numOrNull(r.close);
    const prev = numOrNull(r.prev_close);
    map.set(r.ticker as string, {
      close,
      change: close != null && prev != null ? close - prev : null,
      changePct: close != null && prev ? (close / prev - 1) * 100 : null,
      asOf: (r.trade_date as string) ?? null,
    });
  }
  const missing = tickers.filter((t) => !map.has(t));
  const sb = getSupabase();
  if (!sb || missing.length === 0) return map;

  const { data } = await sb
    .from("v_latest_quote")
    .select("ticker, trade_date, close, change, change_pct")
    .in("ticker", missing);

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
    .select("ticker, market, name_ko, name_en, currency, kind")
    .eq("ticker", ticker)
    .maybeSingle();
  return data ? mapSymbol(data) : null;
}

export async function getStock(ticker: string): Promise<StockResponse | null> {
  const sb = getSupabase();
  if (!sb) return null;

  // 셋 다 ticker 만 있으면 되므로 한 번에 조회합니다(DB 왕복 2단계 → 1단계)
  const [symbol, quotes, signalRow] = await Promise.all([
    getSymbol(ticker),
    getLatestQuotes([ticker]),
    sb
      .from("daily_signals")
      .select("score, zone, summary, breakdown, tags, trade_date, short_term")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!symbol) return null;

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
      shortTerm: (sr.short_term as Signal["shortTerm"]) ?? null,
    };
  }

  return { symbol, price, signal };
}

// ---------- 지표 상세 (S-05) ----------
/** 마지막으로 확정된 종가와 그 날짜(배치가 채운 값). 현재가의 신선도·장 마감 후 판정에 씁니다. */
export async function getLastClose(ticker: string): Promise<{ close: number; date: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("daily_prices")
    .select("close, trade_date")
    .eq("ticker", ticker)
    .order("trade_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.close) return null;
  return { close: Number(data.close), date: data.trade_date as string };
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
// 배치가 하루 두 번 갱신하는 값이라 5분 캐시합니다
const qLatestMacro = unstable_cache(
  async () => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from("daily_macro")
      .select("*")
      .order("trade_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },
  ["latest-macro-v1"],
  { revalidate: 300, tags: ["home"] },
);

export async function getMacro(): Promise<Macro | null> {
  const data = await qLatestMacro().catch(() => null);
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

/** 일봉·지표는 배치 때만 바뀌므로 종목·기간별로 5분 캐시합니다 */
export const getChart = unstable_cache(
  (ticker: string, range: ChartRange) => loadChart(ticker, range),
  ["chart-v2"],
  { revalidate: 300, tags: ["home"] },
);

async function loadChart(
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

  // 이동평균·볼린저 선은 일봉에서 직접 계산합니다(2026-10: 지표 테이블은 최근 1년치만 보관).
  // MA120 이 차트 첫날부터 그려지도록 기간 앞쪽으로 워밍업 120거래일을 더 읽습니다.
  const WARMUP = 120;
  const [inRangeRes, warmupRes] = await Promise.all([
    sb
      .from("daily_prices")
      .select("trade_date, open, high, low, close, volume")
      .eq("ticker", ticker)
      .gte("trade_date", cutoffStr)
      .order("trade_date", { ascending: true }),
    sb
      .from("daily_prices")
      .select("trade_date, close")
      .eq("ticker", ticker)
      .lt("trade_date", cutoffStr)
      .order("trade_date", { ascending: false })
      .limit(WARMUP),
  ]);

  const prices = inRangeRes.data ?? [];
  const warm = [...(warmupRes.data ?? [])].reverse();

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

  // 종가 시계열(워밍업 + 기간) → 이동평균·볼린저(20, ±2σ, 모표준편차 — batch/indicators.py 와 같은 정의)
  const closes = [...warm.map((r) => Number(r.close)), ...series.candles.map((c) => c.close)];
  const offset = warm.length;
  const mean = (end: number, n: number) => {
    let s = 0;
    for (let j = end - n + 1; j <= end; j++) s += closes[j];
    return s / n;
  };
  for (let k = 0; k < series.candles.length; k++) {
    const i = offset + k;
    const t = series.candles[k].time;
    if (i >= 19) {
      const m20 = mean(i, 20);
      let v = 0;
      for (let j = i - 19; j <= i; j++) v += (closes[j] - m20) ** 2;
      const sd = Math.sqrt(v / 20);
      series.ma20.push({ time: t, value: m20 });
      series.bbMid.push({ time: t, value: m20 });
      series.bbUpper.push({ time: t, value: m20 + 2 * sd });
      series.bbLower.push({ time: t, value: m20 - 2 * sd });
      // 엔벨로프 = MA20 × (1 ± 0.10)
      series.envUpper.push({ time: t, value: m20 * 1.1 });
      series.envLower.push({ time: t, value: m20 * 0.9 });
    }
    if (i >= 59) series.ma60.push({ time: t, value: mean(i, 60) });
    if (i >= 119) series.ma120.push({ time: t, value: mean(i, 120) });
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
  /** ETF 여부(목록에 'ETF' 표시) */
  etf: boolean;
  /** 볼린저 밴드 통과(관심 종목 알림). 없으면 빈 배열 */
  bb: BbEvent[];
  /** bb 이벤트별 실측(같은 시장) — 알림의 근거 한 줄용 */
  bbStats: Record<string, PatternStat>;
}

export async function getFavoriteRows(tickers: string[]): Promise<FavoriteRow[]> {
  const sb = getSupabase();
  if (!sb || tickers.length === 0) return [];

  const [symRes, sigRes, quotes, statRows] = await Promise.all([
    sb.from("symbols").select("ticker, market, name_ko, name_en, currency, kind").in("ticker", tickers),
    latestSignals(tickers),
    getLatestQuotes(tickers),
    getHomeStatRows().catch(() => []),
  ]);

  const syms = symRes.data ?? [];
  const wanted = new Set(tickers);
  const bbByTicker = new Map(
    statRows
      .filter((r) => wanted.has(r.ticker as string))
      .map((r) => [r.ticker as string, bbEventsOf(r)] as const)
      .filter(([, ev]) => ev.length > 0),
  );
  // 알림이 있을 때만 실측을 읽습니다(1시간 캐시)
  const regions = new Set(syms.filter((r) => bbByTicker.has(r.ticker as string)).map((r) => regionOf(r.market as string)));
  const statsBy: Partial<Record<"KR" | "US", Record<string, PatternStat>>> = {};
  await Promise.all(
    [...regions].map(async (g) => {
      statsBy[g] = await getPatternStats(g).catch(() => ({}));
    }),
  );

  return syms.map((r) => {
    const qt = quotes.get(r.ticker as string);
    const sig = sigRes.get(r.ticker as string);
    const bb = bbByTicker.get(r.ticker as string) ?? [];
    const all = statsBy[regionOf(r.market as string)] ?? {};
    const bbStats: Record<string, PatternStat> = {};
    for (const e of bb) if (all[e.key]) bbStats[e.key] = all[e.key];
    return {
      ticker: r.ticker as string,
      name: displayName(r),
      market: r.market as Market,
      currency: (r.currency as "KRW" | "USD") ?? "KRW",
      price: qt?.close ?? null,
      changePct: qt?.changePct ?? null,
      score: sig?.score ?? null,
      zone: sig?.zone ?? null,
      etf: r.kind === "etf",
      bb,
      bbStats,
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
  // 홈과 같은 mv_home_stats 캐시(5분)를 씁니다 — 요청마다 전 종목 종가를 두 번 읽던 조회를 없앰
  const rows = await getHomeStatRows().catch(() => []);
  const n = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  const me = rows.find((r) => r.ticker === ticker);
  if (!me) return out;

  // mv 의 hi52/lo52 는 최신 거래일을 뺀 1년이라 그날 고가·저가를 더합니다
  const hs = [n(me.hi52), n(me.high)].filter((v): v is number => v != null);
  const ls = [n(me.lo52), n(me.low)].filter((v): v is number => v != null);
  out.high52 = hs.length ? Math.max(...hs) : null;
  out.low52 = ls.length ? Math.min(...ls) : null;

  const mom = (r: Record<string, unknown>) => {
    const c21 = n(r.close_21), c252 = n(r.close_252);
    return c21 && c252 ? c21 / c252 - 1 : null;
  };
  const mine = mom(me);
  if (mine == null) return out;
  out.mom12 = mine * 100;

  // 같은 시장 안 순위
  const rets = rows
    .filter((r) => regionOf(r.market as string) === region)
    .map(mom)
    .filter((v): v is number => v != null);
  if (rets.length >= 10) {
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
  // mv_home_stats 캐시에 있는 최신 판정을 먼저 쓰고, 없는 종목만 v_latest_signal 뷰로
  const want = new Set(tickers);
  for (const r of await getHomeStatRows().catch(() => [])) {
    if (!want.has(r.ticker as string) || r.score == null || !r.zone) continue;
    map.set(r.ticker as string, { score: Number(r.score), zone: r.zone as Zone });
  }
  const missing = tickers.filter((t) => !map.has(t));
  const sb = getSupabase();
  if (!sb || missing.length === 0) return map;
  const { data } = await sb
    .from("v_latest_signal")
    .select("ticker, score, zone")
    .in("ticker", missing);
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

// ---------- 단기 신호: 패턴 실측 ----------
/** 시장(KR/US)별 패턴 실측. 주 1회 바뀌므로 1시간 캐시합니다. */
export const getPatternStats = unstable_cache(
  async (region: "KR" | "US"): Promise<Record<string, PatternStat>> => {
    const sb = getSupabase();
    if (!sb) return {};
    const { data } = await sb.from("pattern_stats").select("*").eq("region", region);
    const out: Record<string, PatternStat> = {};
    for (const r of data ?? []) {
      out[r.pattern as string] = {
        pattern: r.pattern as string,
        n: Number(r.n),
        nDays: Number(r.n_days),
        ret5: Number(r.ret5),
        baseRet5: Number(r.base_ret5),
        win5: Number(r.win5),
        baseWin5: Number(r.base_win5),
        excess5: Number(r.excess5),
        se5: r.se5 != null ? Number(r.se5) : null,
        periodFrom: (r.period_from as string) ?? null,
        periodTo: (r.period_to as string) ?? null,
      };
    }
    return out;
  },
  ["pattern-stats-v1"],
  { revalidate: 3600 },
);

// ---------- N일 뒤 전망 ----------
interface OutlookModelRow {
  horizon: number;
  enabled: boolean;
  wf: OutlookHorizon["wf"];
  rangeWf: OutlookHorizon["rangeWf"];
}

/** 시장별 방향·범위 모델의 게이트와 검증 성적. 주 1회 바뀌므로 1시간 캐시. */
const getOutlookModels = unstable_cache(
  async (region: "KR" | "US"): Promise<OutlookModelRow[]> => {
    const sb = getSupabase();
    if (!sb) return [];
    const { data } = await sb.from("direction_models").select("horizon,enabled,wf,range_wf").eq("region", region);
    return (data ?? []).map((r) => {
      const wf = r.wf as Record<string, unknown> | null;
      const rw = r.range_wf as Record<string, unknown> | null;
      return {
        horizon: Number(r.horizon),
        enabled: Boolean(r.enabled),
        wf: wf
          ? {
              skill: Number(wf.skill),
              skillSe: Number(wf.skill_se),
              csAuc: wf.cs_auc != null ? Number(wf.cs_auc) : null,
              from: String(wf.from ?? ""),
              to: String(wf.to ?? ""),
            }
          : null,
        rangeWf: rw ? { coverage: Number(rw.coverage), pinballSkill: Number(rw.pinball_skill) } : null,
      };
    });
  },
  ["outlook-models-v1"],
  { revalidate: 3600 },
);

/** 종목의 최신 N일 뒤 전망(5·10·20거래일). 배치가 하루 한 번 갱신하므로 5분 캐시. */
export const getOutlook = unstable_cache(
  async (ticker: string, region: "KR" | "US"): Promise<Outlook | null> => {
    const sb = getSupabase();
    if (!sb) return null;
    const [{ data }, models] = await Promise.all([
      sb.from("direction_latest").select("*").eq("ticker", ticker).maybeSingle(),
      getOutlookModels(region),
    ]);
    if (!data) return null;
    const num = (v: unknown) => (v == null ? null : Number(v));
    const drivers = (data.drivers ?? {}) as Record<string, [string, number, number][]>;
    const horizons: OutlookHorizon[] = [];
    for (const h of [5, 10, 20]) {
      const p = num(data[`p${h}`]);
      const base = num(data[`base${h}`]);
      if (p == null || base == null) continue;
      const m = models.find((x) => x.horizon === h);
      horizons.push({
        h,
        p,
        base,
        lo: num(data[`lo${h}`]),
        mid: num(data[`mid${h}`]),
        hi: num(data[`hi${h}`]),
        drivers: drivers[String(h)] ?? [],
        enabled: m?.enabled ?? false,
        wf: m?.wf ?? null,
        rangeWf: m?.rangeWf ?? null,
      });
    }
    return horizons.length ? { asOf: data.trade_date as string, horizons } : null;
  },
  ["outlook-v1"],
  { revalidate: 300 },
);

// ---------- 단기 신호: 패턴 차트용 최근 봉 ----------
export interface MiniCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 볼린저 밴드(20일 ±2σ) — 볼린저 패턴일 때 차트에 선으로 그림 */
  bbUpper: number | null;
  bbLower: number | null;
}

/** 판정 기준일(upTo)까지의 최근 n개 일봉(오름차순). 패턴 차트에 씁니다. 5분 캐시. */
export const getRecentCandles = unstable_cache(
  async (ticker: string, upTo: string, n = 12): Promise<MiniCandle[]> => {
    const sb = getSupabase();
    if (!sb) return [];
    const [{ data }, { data: ind }] = await Promise.all([
      sb.from("daily_prices")
        .select("trade_date, open, high, low, close, volume")
        .eq("ticker", ticker)
        .lte("trade_date", upTo)
        .order("trade_date", { ascending: false })
        .limit(n),
      sb.from("daily_indicators")
        .select("trade_date, bb_upper, bb_lower")
        .eq("ticker", ticker)
        .lte("trade_date", upTo)
        .order("trade_date", { ascending: false })
        .limit(n),
    ]);
    const bands = new Map((ind ?? []).map((r) => [r.trade_date as string, r]));
    return (data ?? [])
      .map((r) => {
        const b = bands.get(r.trade_date as string);
        return {
          date: r.trade_date as string,
          open: Number(r.open),
          high: Number(r.high),
          low: Number(r.low),
          close: Number(r.close),
          volume: Number(r.volume),
          bbUpper: b?.bb_upper != null ? Number(b.bb_upper) : null,
          bbLower: b?.bb_lower != null ? Number(b.bb_lower) : null,
        };
      })
      .reverse();
  },
  ["recent-candles-v2"],
  { revalidate: 300, tags: ["home"] },
);
