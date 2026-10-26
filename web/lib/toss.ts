// ============================================================
// 앱인토스 미니앱 전용 응답 (서버 전용) — /api/toss/* 가 씁니다.
//
// 앱인토스 운영 정책은 "종목 추천·투자 전략 안내" 서비스를 막으므로, 이 응답에는
// 판정 점수·점수 순위·오를 확률·패턴 실측 수익·매수/매도 문구를 아예 넣지 않습니다.
// 화면에서 숨기는 것으로는 부족해서(심사 때 네트워크 응답도 볼 수 있음) 서버에서 걸러냅니다.
// 문구는 과거·현재 사실만 말합니다. 기획: 앱인토스_기획서.md
// ============================================================

import "server-only";
import { unstable_cache } from "next/cache";
import { getIndicators, getOutlook, getStock, getStockExtras } from "./db";
import { getHomeData, getHomeStatRows, getMarketTemps, type BbEvent, type HomeRow } from "./home";
import { getSupabase } from "./supabase";
import type { Currency, Indicators, Market, Zone } from "./types";

export const DISCLAIMER = "과거 가격 데이터를 정리한 정보예요. 특정 종목의 매매를 권하지 않아요.";

const KR_MARKETS = new Set(["KOSPI", "KOSDAQ"]);
const regionOf = (market: string): "KR" | "US" => (KR_MARKETS.has(market) ? "KR" : "US");
const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v: number | null, d = 2) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// ---------- 흐름 상태 (점수 대신 이름만) ----------
export type FlowState = "up" | "up_lean" | "side" | "down_lean" | "down" | "none";

const FLOW: Record<Zone, { state: FlowState; label: string; desc: string }> = {
  BUY: { state: "up", label: "오르는 흐름", desc: "최근 여러 지표가 함께 오른 흐름을 보였어요." },
  BUY_LEAN: { state: "up_lean", label: "조금 오르는 흐름", desc: "최근 오른 쪽 지표가 조금 더 많았어요." },
  NEUTRAL: { state: "side", label: "옆걸음", desc: "최근 오른 지표와 내린 지표가 비슷했어요." },
  SELL_LEAN: { state: "down_lean", label: "조금 내리는 흐름", desc: "최근 내린 쪽 지표가 조금 더 많았어요." },
  SELL: { state: "down", label: "내리는 흐름", desc: "최근 여러 지표가 함께 내린 흐름을 보였어요." },
  UNAVAILABLE: { state: "none", label: "정보 부족", desc: "상장 1년 미만이거나 데이터가 부족해 흐름을 정리하지 않았어요." },
};
const flowOf = (z: Zone | null | undefined) => FLOW[z ?? "UNAVAILABLE"] ?? FLOW.UNAVAILABLE;

export interface TossRow {
  ticker: string;
  name: string;
  market: Market;
  currency: Currency;
  etf: boolean;
  price: number | null;
  changePct: number | null;
  flow: { state: FlowState; label: string };
}

const toRow = (r: HomeRow): TossRow => {
  const f = flowOf(r.zone);
  return {
    ticker: r.ticker,
    name: r.name,
    market: r.market,
    currency: r.currency,
    etf: !!r.etf,
    price: r.price,
    changePct: round(r.changePct),
    flow: { state: f.state, label: f.label },
  };
};

// ---------- 홈 ----------
export interface TossHome {
  marketFlow: Record<"KR" | "US", { up: number; side: number; down: number; asOf: string | null }>;
  indicators: { key: string; label: string; kind: string; value: number; change: number; date: string; spark: number[]; note?: string }[];
  movers: Record<"highs" | "lows" | "volume", { total: number; items: (TossRow & { volRatio?: number })[] }>;
  sectors: Record<"KR" | "US", { name: string; count: number; up: number; side: number; down: number; avgChangePct: number | null }[]>;
  disclaimer: string;
}

const MOVERS = 10;

export async function getTossHome(): Promise<TossHome | null> {
  const [home, temps] = await Promise.all([getHomeData(), getMarketTemps().catch(() => [])]);
  if (!home) return null;

  const breadth = (b: typeof home.breadth.KR) => ({ up: b.up, side: b.neutral, down: b.down, asOf: b.asOf });
  // 업종은 평균 점수 순이 아니라 종목 수 → 이름 순(점수로 줄 세우지 않음)
  const sectors = (list: typeof home.sectors.KR) =>
    list
      .map((s) => ({ name: s.name, count: s.count, up: s.up, side: s.neutral, down: s.down, avgChangePct: round(s.avgChange) }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

  return {
    marketFlow: { KR: breadth(home.breadth.KR), US: breadth(home.breadth.US) },
    // VIX 설명은 '판정 점수를 줄였다'는 내용이라 뺍니다
    indicators: temps.map((t) => (t.key === "vix" ? { ...t, note: undefined } : t)),
    movers: {
      highs: { total: home.movers.highs.length, items: home.movers.highs.slice(0, MOVERS).map(toRow) },
      lows: { total: home.movers.lows.length, items: home.movers.lows.slice(0, MOVERS).map(toRow) },
      volume: {
        total: home.movers.volume.length,
        items: home.movers.volume.slice(0, MOVERS).map((r) => ({ ...toRow(r), volRatio: round(r.value, 1)! })),
      },
    },
    sectors: { KR: sectors(home.sectors.KR), US: sectors(home.sectors.US) },
    disclaimer: DISCLAIMER,
  };
}

// ---------- 종목 ----------
export interface TossStock {
  symbol: { ticker: string; name: string; market: Market; currency: Currency; etf: boolean };
  price: { close: number; change: number; changePct: number; asOf: string } | null;
  flow: { state: FlowState; label: string; desc: string; reasons: string[]; asOf: string | null };
  /** 평소 출렁임 폭 — 과거에 10번 중 8번 들어온 수익률 범위 */
  range: {
    asOf: string;
    items: { days: number; loPct: number; hiPct: number; loPrice: number | null; hiPrice: number | null }[];
    /** 과거 검증에서 실제로 이 범위에 들어온 비율(0~1) */
    coverage: number | null;
    period: { from: string; to: string } | null;
  } | null;
  position: {
    high52: number | null;
    low52: number | null;
    /** 52주 최저(0)~최고(1) 사이 현재 위치 */
    pos52: number | null;
    /** 종가가 이동평균보다 몇 % 위(+)/아래(−) */
    maGapPct: { ma20: number | null; ma60: number | null; ma120: number | null };
    band: { percentB: number; label: string } | null;
  };
  facts: { key: string; title: string; value: string; text: string }[];
  yearReturn: { pct: number; topPct: number | null; peers: number; region: "KR" | "US" } | null;
  /** 국내 종목만: 투자자별 순매수(백만원) */
  investors: { asOf: string; days: number; latest: InvestorAmt; sum: InvestorAmt } | null;
  disclaimer: string;
}

type InvestorAmt = { foreign: number; inst: number; indiv: number };

function bandLabel(pb: number): string {
  if (pb > 1) return "밴드 상단 밖";
  if (pb >= 0.8) return "상단 근처";
  if (pb >= 0.2) return "가운데";
  if (pb >= 0) return "하단 근처";
  return "밴드 하단 밖";
}

/** 지표를 사실 문장으로. 좋다/나쁘다를 말하지 않습니다. */
function factsOf(i: Indicators | null): TossStock["facts"] {
  if (!i) return [];
  const out: TossStock["facts"] = [];
  if (i.ma20 != null && i.ma60 != null && i.ma120 != null) {
    const order =
      i.ma20 > i.ma60 && i.ma60 > i.ma120 ? "정배열" : i.ma20 < i.ma60 && i.ma60 < i.ma120 ? "역배열" : "혼조";
    out.push({
      key: "ma",
      title: "이동평균선 배열",
      value: order,
      text:
        order === "정배열"
          ? "짧은 기간 평균(20일)이 긴 기간 평균(60·120일)보다 위에 차례로 놓여 있어요. 최근 가격이 더 높았다는 뜻이에요."
          : order === "역배열"
            ? "짧은 기간 평균(20일)이 긴 기간 평균(60·120일)보다 아래에 차례로 놓여 있어요. 최근 가격이 더 낮았다는 뜻이에요."
            : "20·60·120일 평균선이 서로 엇갈려 있어요.",
    });
  }
  if (i.rsi14 != null) {
    const v = i.rsi14;
    out.push({
      key: "rsi",
      title: "RSI (14일)",
      value: v.toFixed(0),
      text:
        v >= 70 ? "최근 14일 동안 오른 폭이 내린 폭보다 훨씬 컸어요."
          : v >= 55 ? "최근 14일 동안 오른 폭이 내린 폭보다 조금 컸어요."
            : v > 45 ? "최근 14일 동안 오른 폭과 내린 폭이 비슷했어요."
              : v > 30 ? "최근 14일 동안 내린 폭이 오른 폭보다 조금 컸어요."
                : "최근 14일 동안 내린 폭이 오른 폭보다 훨씬 컸어요.",
    });
  }
  if (i.macd != null && i.macdSignal != null) {
    const above = i.macd >= i.macdSignal;
    out.push({
      key: "macd",
      title: "MACD",
      value: above ? "시그널선 위" : "시그널선 아래",
      text: above
        ? "MACD가 자신의 9일 평균(시그널선)보다 위에 있어요. 최근 단기 가격 평균이 장기 평균보다 상대적으로 더 올라왔어요."
        : "MACD가 자신의 9일 평균(시그널선)보다 아래에 있어요. 최근 단기 가격 평균이 장기 평균보다 상대적으로 더 내려왔어요.",
    });
  }
  if (i.volRatio20 != null) {
    out.push({
      key: "volume",
      title: "거래량",
      value: `20일 평균의 ${i.volRatio20.toFixed(1)}배`,
      text: `최근 거래일 거래량이 지난 20일 평균의 ${i.volRatio20.toFixed(1)}배였어요.`,
    });
  }
  if (i.bbWidth != null) {
    out.push({
      key: "bbWidth",
      title: "볼린저 밴드 폭",
      value: `${(i.bbWidth * 100).toFixed(1)}%`,
      text: "밴드 폭은 최근 20일 동안 가격이 얼마나 넓게 움직였는지를 보여줘요. 넓을수록 출렁임이 컸어요.",
    });
  }
  return out;
}

/** 판정 이유 태그("pos:MA 정배열")에서 사실 이름만 남깁니다(좋다/나쁘다 색은 버림) */
const reasonsOf = (tags: string[]) => tags.map((t) => t.replace(/^(pos|neg|neu):/, "")).slice(0, 5);

const qInvestor = unstable_cache(
  async (ticker: string) => {
    const sb = getSupabase();
    if (!sb) return null;
    const { data, error } = await sb
      .from("daily_investor_flow")
      .select("trade_date, foreign_net_amt, inst_net_amt, indiv_net_amt")
      .eq("ticker", ticker)
      .order("trade_date", { ascending: false })
      .limit(20);
    if (error) throw error;
    return data;
  },
  ["toss-investor-v1"],
  { revalidate: 300, tags: ["home"] },
);

async function investorsOf(ticker: string): Promise<TossStock["investors"]> {
  const rows = await qInvestor(ticker).catch(() => null);
  if (!rows?.length) return null;
  const amt = (r: Record<string, unknown>): InvestorAmt => ({
    foreign: Number(r.foreign_net_amt ?? 0),
    inst: Number(r.inst_net_amt ?? 0),
    indiv: Number(r.indiv_net_amt ?? 0),
  });
  const sum = rows.map(amt).reduce((a, b) => ({ foreign: a.foreign + b.foreign, inst: a.inst + b.inst, indiv: a.indiv + b.indiv }));
  return { asOf: rows[0].trade_date as string, days: rows.length, latest: amt(rows[0]), sum };
}

export async function getTossStock(ticker: string): Promise<TossStock | null> {
  const indicatorsP = getIndicators(ticker);
  const stock = await getStock(ticker);
  if (!stock) return null;
  const { symbol, price, signal } = stock;
  const region = regionOf(symbol.market);

  const [indicators, extras, outlook, investors] = await Promise.all([
    indicatorsP,
    getStockExtras(symbol.ticker, symbol.market),
    getOutlook(symbol.ticker, region).catch(() => null),
    region === "KR" ? investorsOf(symbol.ticker) : Promise.resolve(null),
  ]);

  const f = flowOf(signal?.zone);
  const close = price?.close ?? null;

  // 출렁임 폭: 80% 구간(lo~hi)만. 오를 확률·중간값·근거 피처는 넣지 않습니다.
  let range: TossStock["range"] = null;
  if (outlook) {
    // 가격 환산은 전망 기준일 종가와 화면 종가가 같을 때만
    const px = close != null && price?.asOf === outlook.asOf ? close : null;
    const items = outlook.horizons
      .filter((o) => o.lo != null && o.hi != null)
      .map((o) => ({
        days: o.h,
        loPct: round(o.lo! * 100, 1)!,
        hiPct: round(o.hi! * 100, 1)!,
        loPrice: px != null ? round(px * (1 + o.lo!)) : null,
        hiPrice: px != null ? round(px * (1 + o.hi!)) : null,
      }));
    const rw = outlook.horizons.find((o) => o.rangeWf)?.rangeWf;
    const wf = outlook.horizons.find((o) => o.wf)?.wf;
    if (items.length) {
      range = {
        asOf: outlook.asOf,
        items,
        coverage: rw ? round(rw.coverage, 3) : null,
        period: wf?.from && wf?.to ? { from: wf.from, to: wf.to } : null,
      };
    }
  }

  const { high52, low52 } = extras;
  const gap = (ma: number | null) => (close != null && ma ? round((close / ma - 1) * 100, 1) : null);
  const top = extras.mom12Rank != null ? Math.max(1, Math.round((1 - extras.mom12Rank) * 100)) : null;

  return {
    symbol: {
      ticker: symbol.ticker,
      name: symbol.nameKo || symbol.nameEn || symbol.ticker,
      market: symbol.market,
      currency: symbol.currency,
      etf: symbol.kind === "etf",
    },
    price: price ? { ...price, changePct: round(price.changePct)! } : null,
    flow: {
      state: f.state,
      label: f.label,
      desc: f.desc,
      reasons: signal && signal.zone !== "UNAVAILABLE" ? reasonsOf(signal.tags) : [],
      asOf: signal?.asOf || null,
    },
    range,
    position: {
      high52,
      low52,
      pos52: close != null && high52 != null && low52 != null && high52 > low52
        ? round(Math.min(1, Math.max(0, (close - low52) / (high52 - low52))), 3)
        : null,
      maGapPct: { ma20: gap(indicators?.ma20 ?? null), ma60: gap(indicators?.ma60 ?? null), ma120: gap(indicators?.ma120 ?? null) },
      band: indicators?.bbPercentB != null
        ? { percentB: round(indicators.bbPercentB, 2)!, label: bandLabel(indicators.bbPercentB) }
        : null,
    },
    facts: factsOf(indicators),
    yearReturn: extras.mom12 != null
      ? { pct: round(extras.mom12, 1)!, topPct: top, peers: extras.peers, region: extras.region }
      : null,
    investors,
    disclaimer: DISCLAIMER,
  };
}

// ---------- 관심 종목 ----------
export interface TossFavorite extends TossRow {
  pos52: number | null;
  /** 최근 거래일에 바뀐 점 — 사실만 */
  changes: { kind: "flow" | "band" | "high52" | "low52"; text: string; date: string | null }[];
}

// 배치 patterns.py 설명에는 '매수 고려' 같은 문구가 있어서 여기서 사실 문장으로 바꿉니다
const BAND_TEXT: Record<BbEvent["key"], string> = {
  bb_lower_break: "종가가 볼린저 밴드 하단 아래에서 마감했어요",
  bb_lower_reentry: "하단 아래에 있던 종가가 밴드 안으로 돌아왔어요",
  bb_upper_break: "종가가 볼린저 밴드 상단 위에서 마감했어요",
  bb_upper_reentry: "상단 위에 있던 종가가 밴드 안으로 내려왔어요",
};

export const FAVORITES_MAX = 50;

export async function getTossFavorites(tickers: string[]): Promise<{ items: TossFavorite[]; missing: string[] } | null> {
  const [home, stats] = await Promise.all([getHomeData(), getHomeStatRows().catch(() => [])]);
  if (!home) return null;
  const statBy = new Map(stats.map((s) => [s.ticker as string, s]));

  const items: TossFavorite[] = [];
  const missing: string[] = [];
  for (const t of tickers) {
    const row = home.byTicker.get(t);
    const s = statBy.get(t);
    if (!row || !s) {
      missing.push(t);
      continue;
    }
    const date = (s.trade_date as string) ?? null;
    const changes: TossFavorite["changes"] = [];
    const zone = s.zone as Zone | null;
    const prev = s.zone_prev as Zone | null;
    if (zone && prev && zone !== "UNAVAILABLE" && prev !== "UNAVAILABLE" && flowOf(zone).state !== flowOf(prev).state) {
      changes.push({ kind: "flow", text: `흐름이 '${flowOf(prev).label}'에서 '${flowOf(zone).label}'으로 바뀌었어요` /* 상태 이름이 모두 받침(ㄹ 아님)으로 끝남 */, date: (s.signal_date as string) ?? date });
    }
    for (const e of home.bbByTicker.get(t) ?? []) changes.push({ kind: "band", text: BAND_TEXT[e.key], date: e.date });

    const high = num(s.high), low = num(s.low), hi52 = num(s.hi52), lo52 = num(s.lo52), close = num(s.close);
    if (high != null && hi52 != null && high >= hi52) changes.push({ kind: "high52", text: "52주 신고가를 기록했어요", date });
    if (low != null && lo52 != null && low <= lo52) changes.push({ kind: "low52", text: "52주 신저가를 기록했어요", date });

    // mv 의 hi52/lo52 는 최신 거래일을 뺀 1년이라 그날 고가·저가를 더합니다(getStockExtras 와 같은 방식)
    const h = Math.max(...[hi52, high].filter((v): v is number => v != null));
    const l = Math.min(...[lo52, low].filter((v): v is number => v != null));
    const pos52 = close != null && Number.isFinite(h) && Number.isFinite(l) && h > l ? round((close - l) / (h - l), 3) : null;

    items.push({ ...toRow(row), pos52, changes });
  }
  return { items, missing };
}
