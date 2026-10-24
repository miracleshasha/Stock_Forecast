import "server-only";
import { unstable_cache } from "next/cache";
import { getSupabase } from "./supabase";

interface ResearchResult {
  model: string; name: string; region: string; cost_multiplier: number;
  total_return: number; market_excess: number; max_drawdown: number;
  trade_count: number; annualized_turnover: number;
  winning_quarters_vs_market: number; quarter_count: number; quarters: Record<string, number>;
}
export interface ResearchReport {
  created_at: string;
  settings: { buy_bps: number; sell_bps: number; stress_multiplier: number };
  data: { stocks: number };
  folds: { region: string; test_from: string; test_to: string }[];
  results: ResearchResult[]; offset_results: ResearchResult[];
  limitations: string[]; diagnostics: unknown[];
}

/** Private bucket: no public URL, client credentials, or report embedded in source code. */
export const getRankEvaluationReport = unstable_cache(async (): Promise<ResearchReport | null> => {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from("owner-model-research").download("rank-evaluation/latest.json");
  if (error || !data) return null;
  const r = JSON.parse(await data.text()) as ResearchReport;
  if (!Array.isArray(r.results) || !Array.isArray(r.folds) || !Array.isArray(r.offset_results)
      || !Array.isArray(r.limitations) || !Array.isArray(r.diagnostics) || !r.settings || !r.data) return null;
  return r;
}, ["owner-rank-research-v1"], { revalidate: 60 });
