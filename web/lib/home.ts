// ============================================================
// 홈 화면 데이터 (서버 전용)
//
// 종목별 수치는 배치가 갱신하는 mv_home_stats(종목당 한 줄) 한 번 읽기로 만듭니다.
// 시장 온도계의 미국 지표는 FRED 공개 CSV 를 1시간 캐시해서 씁니다.
// ============================================================

import "server-only";
import { unstable_cache } from "next/cache";
import { getSupabase } from "./supabase";
import type { Currency, Market, Zone } from "./types";

export type Region = "ALL" | "KR" | "US";
const KR_MARKETS = new Set(["KOSPI", "KOSDAQ"]);
const regionOf = (market: string): "KR" | "US" => (KR_MARKETS.has(market) ? "KR" : "US");

export interface HomeRow {
  ticker: string;
  name: string;
  market: Market;
  currency: Currency;
  price: number | null;
  changePct: number | null;
  score: number | null;
  zone: Zone | null;
}

/** 목록 행 + 부가 수치(12개월 수익률, 거래량 배수 등) */
export interface RankedRow extends HomeRow {
  value: number;
}

export interface Breadth {
  up: number;
  neutral: number;
  down: number;
  /** 직전 판정일과 비교한 증감 */
  upDelta: number;
  downDelta: number;
  asOf: string | null;
}

export interface HomeData {
  breadth: { KR: Breadth; US: Breadth };
  top: Record<Region, { buys: HomeRow[]; sells: HomeRow[] }>;
  /** 12-1개월 모멘텀 상위 (value = 수익률 %) */
  momentum: { KR: RankedRow[]; US: RankedRow[] };
  /** 52주 신고가·신저가, 거래량 급증 (value = 거래량 배수) */
  movers: { highs: HomeRow[]; lows: HomeRow[]; volume: RankedRow[] };
  /** ⑥ 업종별 흐름 (3종목 이상인 업종만, 평균 점수 높은 순) */
  sectors: { KR: SectorStat[]; US: SectorStat[] };
  /** 종목별 행 조회용(즐겨찾기 요약) */
  byTicker: Map<string, HomeRow>;
}

export interface SectorStat {
  name: string;
  count: number;
  up: number;
  neutral: number;
  down: number;
  avgScore: number;
  /** 최근 거래일 평균 등락률(%) */
  avgChange: number | null;
}

const SECTOR_MIN = 3;

type Stat = {
  ticker: string;
  market: string;
  trade_date: string;
  close: number | null;
  high: number | null;
  low: number | null;
  prev_close: number | null;
  hi52: number | null;
  lo52: number | null;
  vol_ratio20: number | null;
  close_21: number | null;
  close_252: number | null;
  score: number | null;
  zone: Zone | null;
  signal_date: string | null;
  zone_prev: Zone | null;
};

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const upZone = (z: Zone | null) => z === "BUY" || z === "BUY_LEAN";
const downZone = (z: Zone | null) => z === "SELL" || z === "SELL_LEAN";

export async function getHomeData(limit = 5): Promise<HomeData | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const [statRes, symRes] = await Promise.all([
    sb.from("mv_home_stats").select("*").limit(5000),
    sb.from("symbols").select("ticker, name_ko, name_en, currency, sector").limit(5000),
  ]);
  if (statRes.error) throw statRes.error;
  const names = new Map((symRes.data ?? []).map((r) => [r.ticker as string, r]));

  const stats: Stat[] = (statRes.data ?? []).map((r) => ({
    ...(r as Stat),
    close: num(r.close),
    high: num(r.high),
    low: num(r.low),
    prev_close: num(r.prev_close),
    hi52: num(r.hi52),
    lo52: num(r.lo52),
    vol_ratio20: num(r.vol_ratio20),
    close_21: num(r.close_21),
    close_252: num(r.close_252),
    score: num(r.score),
  }));

  const toRow = (s: Stat): HomeRow => {
    const n = names.get(s.ticker);
    return {
      ticker: s.ticker,
      name: (n?.name_ko as string) || (n?.name_en as string) || s.ticker,
      market: s.market as Market,
      currency: ((n?.currency as Currency) ?? (regionOf(s.market) === "KR" ? "KRW" : "USD")),
      price: s.close,
      changePct: s.close != null && s.prev_close ? (s.close / s.prev_close - 1) * 100 : null,
      score: s.score,
      zone: s.zone,
    };
  };
  const byTicker = new Map(stats.map((s) => [s.ticker, toRow(s)]));
  const inRegion = (r: "KR" | "US") => stats.filter((s) => regionOf(s.market) === r);

  // ① 시장 분위기
  const breadthOf = (rows: Stat[]): Breadth => {
    const judged = rows.filter((s) => s.zone && s.zone !== "UNAVAILABLE");
    const up = judged.filter((s) => upZone(s.zone)).length;
    const down = judged.filter((s) => downZone(s.zone)).length;
    const prev = judged.filter((s) => s.zone_prev && s.zone_prev !== "UNAVAILABLE");
    return {
      up,
      down,
      neutral: judged.length - up - down,
      upDelta: up - prev.filter((s) => upZone(s.zone_prev)).length,
      downDelta: down - prev.filter((s) => downZone(s.zone_prev)).length,
      asOf: judged.reduce<string | null>((m, s) => (s.signal_date && (!m || s.signal_date > m) ? s.signal_date : m), null),
    };
  };

  // 기존 상승/하락 흐름 목록
  const topOf = (rows: Stat[]) => {
    const scored = rows.filter((s) => s.score != null && s.zone && s.zone !== "UNAVAILABLE");
    const desc = [...scored].sort((a, b) => b.score! - a.score!);
    return {
      buys: desc.slice(0, limit).filter((s) => s.score! > 0).map(toRow),
      sells: desc.slice(-limit).reverse().filter((s) => s.score! < 0).map(toRow),
    };
  };

  // ④ 12-1개월 모멘텀 상위
  const momentumOf = (rows: Stat[]): RankedRow[] =>
    rows
      .filter((s) => s.close_21 && s.close_252)
      .map((s) => ({ ...toRow(s), value: (s.close_21! / s.close_252! - 1) * 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);

  // ⑤ 특이 종목 (각 지역의 최신 거래일 행만 — 휴장으로 멈춘 종목이 섞이지 않게)
  const latestDate = new Map<string, string>();
  for (const s of stats) {
    const r = regionOf(s.market);
    if (!latestDate.has(r) || s.trade_date > latestDate.get(r)!) latestDate.set(r, s.trade_date);
  }
  const fresh = stats.filter((s) => s.trade_date === latestDate.get(regionOf(s.market)));
  const byChange = (a: HomeRow, b: HomeRow) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0);
  const highs = fresh.filter((s) => s.high != null && s.hi52 != null && s.high >= s.hi52).map(toRow).sort(byChange);
  const lows = fresh.filter((s) => s.low != null && s.lo52 != null && s.low <= s.lo52).map(toRow).sort(byChange);
  const volume = fresh
    .filter((s) => (s.vol_ratio20 ?? 0) >= 2)
    .map((s) => ({ ...toRow(s), value: s.vol_ratio20! }))
    .sort((a, b) => b.value - a.value);

  // ⑥ 업종별 흐름
  const sectorsOf = (rows: Stat[]): SectorStat[] => {
    const groups = new Map<string, Stat[]>();
    for (const s of rows) {
      if (s.score == null || !s.zone || s.zone === "UNAVAILABLE") continue;
      const name = (names.get(s.ticker)?.sector as string) || "기타";
      groups.set(name, [...(groups.get(name) ?? []), s]);
    }
    return [...groups.entries()]
      .filter(([, g]) => g.length >= SECTOR_MIN)
      .map(([name, g]) => {
        const changes = g
          .filter((s) => s.close != null && s.prev_close)
          .map((s) => (s.close! / s.prev_close! - 1) * 100);
        const up = g.filter((s) => upZone(s.zone)).length;
        const down = g.filter((s) => downZone(s.zone)).length;
        return {
          name,
          count: g.length,
          up,
          down,
          neutral: g.length - up - down,
          avgScore: g.reduce((a, s) => a + s.score!, 0) / g.length,
          avgChange: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null,
        };
      })
      .sort((a, b) => b.avgScore - a.avgScore);
  };

  return {
    breadth: { KR: breadthOf(inRegion("KR")), US: breadthOf(inRegion("US")) },
    sectors: { KR: sectorsOf(inRegion("KR")), US: sectorsOf(inRegion("US")) },
    top: { ALL: topOf(stats), KR: topOf(inRegion("KR")), US: topOf(inRegion("US")) },
    momentum: { KR: momentumOf(inRegion("KR")), US: momentumOf(inRegion("US")) },
    movers: { highs, lows, volume },
    byTicker,
  };
}

// ---------- ③ 시장 온도계 ----------
export interface Temp {
  key: string;
  label: string;
  value: number;
  /** 직전 관측치 대비 */
  change: number;
  /** 표시 형식 */
  kind: "index" | "rate" | "spread" | "fx" | "vix" | "usd";
  date: string;
  /** 최근 ~20개 관측치(스파크라인) */
  spark: number[];
  note?: string;
}

async function fredSeries(id: string): Promise<{ date: string; value: number }[]> {
  // 최근 90일만 받습니다(전체 이력은 수백 KB)
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const res = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${since}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FRED ${id} ${res.status}`);
  const out: { date: string; value: number }[] = [];
  for (const line of (await res.text()).trim().split("\n").slice(1)) {
    const [date, raw] = line.split(",");
    const value = Number(raw);
    if (date && raw && raw.trim() !== "." && Number.isFinite(value)) out.push({ date, value });
  }
  return out;
}

const getFred = unstable_cache(
  async () => {
    const ids = ["SP500", "VIXCLS", "DGS10", "T10Y2Y", "DCOILWTICO", "DEXKOUS"] as const;
    const results = await Promise.allSettled(ids.map(fredSeries));
    return Object.fromEntries(ids.map((id, i) => [id, results[i].status === "fulfilled" ? results[i].value : []]));
  },
  ["home-fred-v2"],
  { revalidate: 3600 },
);

// batch/scoring.py STRESS_DAMP 와 같아야 합니다
function dampOf(vix: number): number {
  if (vix < 16) return 1;
  if (vix < 20) return 0.85;
  if (vix < 25) return 0.7;
  return 0.5;
}

function toTemp(
  key: string,
  label: string,
  kind: Temp["kind"],
  series: { date: string; value: number }[],
  note?: (latest: number, date: string) => string,
): Temp | null {
  if (series.length < 2) return null;
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  return {
    key,
    label,
    kind,
    value: last.value,
    change: last.value - prev.value,
    date: last.date,
    spark: series.slice(-20).map((p) => p.value),
    note: note?.(last.value, last.date),
  };
}

export async function getMarketTemps(): Promise<Temp[]> {
  const sb = getSupabase();
  const [fred, kospiRes] = await Promise.all([
    getFred().catch(() => ({}) as Record<string, { date: string; value: number }[]>),
    sb
      ? sb.from("daily_macro").select("trade_date, kospi_close").not("kospi_close", "is", null)
          .order("trade_date", { ascending: false }).limit(30)
      : Promise.resolve({ data: [] as { trade_date: string; kospi_close: number }[] }),
  ]);
  const kospi = [...(kospiRes.data ?? [])]
    .reverse()
    .map((r) => ({ date: r.trade_date as string, value: Number(r.kospi_close) }));

  const temps = [
    toTemp("kospi", "코스피", "index", kospi),
    toTemp("spx", "S&P 500", "index", fred.SP500 ?? []),
    toTemp("vix", "VIX (변동성)", "vix", fred.VIXCLS ?? [], (v) => {
      const d = dampOf(v);
      return d >= 1 ? "판정 점수를 그대로 반영하고 있어요" : `변동성이 커서 판정 점수를 ${Math.round(d * 100)}%로 줄였어요`;
    }),
    toTemp("us10y", "미국 10년물 금리", "rate", fred.DGS10 ?? []),
    toTemp("t10y2y", "장단기 금리차 (10년−2년)", "spread", fred.T10Y2Y ?? [], (v) =>
      v < 0 ? "단기 금리가 더 높은 역전 상태예요" : "장기 금리가 더 높은 정상 상태예요"),
    toTemp("wti", "국제 유가 (WTI)", "usd", fred.DCOILWTICO ?? []),
    toTemp("usdkrw", "원/달러 환율", "fx", fred.DEXKOUS ?? [], () => "미 연준 자료라 1주일가량 늦게 갱신돼요"),
  ];
  return temps.filter((t): t is Temp => t != null);
}

// ---------- ⑦ 외국인·기관 순매수 (국내) ----------
export interface FlowRow extends HomeRow {
  /** 순매수 금액(백만원) */
  value: number;
}
export interface InvestorFlows {
  date: string;
  foreign: FlowRow[];
  inst: FlowRow[];
  /** 분석 종목 합계(백만원) */
  total: { foreign: number; inst: number; indiv: number; count: number };
}

export async function getInvestorFlows(byTicker: Map<string, HomeRow>, limit = 5): Promise<InvestorFlows | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: latest } = await sb
    .from("daily_investor_flow").select("trade_date").order("trade_date", { ascending: false }).limit(1);
  const date = latest?.[0]?.trade_date as string | undefined;
  if (!date) return null;
  const { data } = await sb
    .from("daily_investor_flow")
    .select("ticker, foreign_net_amt, inst_net_amt, indiv_net_amt")
    .eq("trade_date", date)
    .limit(5000);
  const rows = (data ?? []).filter((r) => byTicker.has(r.ticker as string));
  const top = (key: "foreign_net_amt" | "inst_net_amt"): FlowRow[] =>
    rows
      .map((r) => ({ ...byTicker.get(r.ticker as string)!, value: Number(r[key] ?? 0) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, limit);
  const sum = (key: string) => rows.reduce((a, r) => a + Number((r as Record<string, unknown>)[key] ?? 0), 0);
  return {
    date,
    foreign: top("foreign_net_amt"),
    inst: top("inst_net_amt"),
    total: { foreign: sum("foreign_net_amt"), inst: sum("inst_net_amt"), indiv: sum("indiv_net_amt"), count: rows.length },
  };
}

// ---------- ⑨ 다가오는 경제 일정 ----------
export interface EconEvent {
  date: string; // YYYY-MM-DD (한국 날짜)
  timeKst: string | null; // "21:30"
  country: "US" | "KR";
  title: string;
  category: string;
  detail: string | null;
  sourceUrl: string | null;
  /** 오늘 기준 며칠 뒤(0 = 오늘) */
  dday: number;
}

/** 한국 시각 기준 오늘 날짜와 현재 시각 "HH:MM" */
function nowKst(): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

export async function getUpcomingEvents(limit = 5): Promise<EconEvent[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const now = nowKst();
  const { data } = await sb
    .from("econ_events")
    .select("event_date, event_time_kst, country, title, category, detail, source_url")
    .gte("event_date", now.date)
    .order("event_date", { ascending: true })
    .order("event_time_kst", { ascending: true, nullsFirst: true })
    .limit(limit + 3);
  const today = Date.parse(`${now.date}T00:00:00Z`);
  return (data ?? [])
    .map((r) => ({
      date: r.event_date as string,
      timeKst: r.event_time_kst ? String(r.event_time_kst).slice(0, 5) : null,
      country: r.country as "US" | "KR",
      title: r.title as string,
      category: r.category as string,
      detail: (r.detail as string) ?? null,
      sourceUrl: (r.source_url as string) ?? null,
      dday: Math.round((Date.parse(`${r.event_date}T00:00:00Z`) - today) / 864e5),
    }))
    // 오늘 이미 지난 발표는 빼기
    .filter((e) => !(e.dday === 0 && e.timeKst && e.timeKst < now.time))
    .slice(0, limit);
}
