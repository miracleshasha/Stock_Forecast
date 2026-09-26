// ============================================================
// 계정 즐겨찾기 (서버 전용). user_favorites 테이블은 RLS 정책이 없어
// 서비스 롤로만 접근됩니다 — 반드시 getSessionUser() 로 확인한 user_id 만 넘기세요.
// ============================================================

import "server-only";
import { getSupabase } from "./supabase";
import type { FavoriteItem, Market } from "./types";

export const FAVORITES_MAX = 20;

type Row = { ticker: string; market: string; added_at: string };
const toItem = (r: Row): FavoriteItem => ({
  ticker: r.ticker,
  market: r.market as Market,
  addedAt: new Date(r.added_at).getTime(),
});

function db() {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase 환경변수가 없습니다");
  return sb;
}

export async function listFavorites(userId: string): Promise<FavoriteItem[]> {
  const { data, error } = await db()
    .from("user_favorites")
    .select("ticker, market, added_at")
    .eq("user_id", userId)
    .order("added_at", { ascending: true });
  if (error) throw error;
  return (data as Row[]).map(toItem);
}

export type AddResult = "added" | "exists" | "full" | "unknown_ticker";

export async function addFavorite(userId: string, ticker: string, market: Market): Promise<AddResult> {
  const current = await listFavorites(userId);
  if (current.some((f) => f.ticker === ticker)) return "exists";
  if (current.length >= FAVORITES_MAX) return "full";
  const { error } = await db().from("user_favorites").insert({ user_id: userId, ticker, market });
  if (error) {
    if (error.code === "23505") return "exists"; // 동시에 두 번 누른 경우
    if (error.code === "23503") return "unknown_ticker"; // symbols 에 없는 종목
    throw error;
  }
  return "added";
}

export async function removeFavorite(userId: string, ticker: string): Promise<void> {
  const { error } = await db().from("user_favorites").delete().eq("user_id", userId).eq("ticker", ticker);
  if (error) throw error;
}

/**
 * 로그인 전 브라우저에 모아둔 즐겨찾기를 계정으로 합칩니다.
 * 이미 계정에 있는 종목은 건너뛰고, 20개 한도 안에서 추가 시각 순으로 넣습니다.
 */
export async function mergeFavorites(userId: string, items: FavoriteItem[]): Promise<FavoriteItem[]> {
  const current = await listFavorites(userId);
  const have = new Set(current.map((f) => f.ticker));
  const room = FAVORITES_MAX - current.length;
  const toAdd = items
    .filter((f) => !have.has(f.ticker))
    .sort((a, b) => a.addedAt - b.addedAt)
    .slice(0, Math.max(0, room));
  if (toAdd.length > 0) {
    // 없는 종목이 섞여도 나머지는 들어가도록 한 건씩 넣습니다(최대 20건)
    for (const f of toAdd) {
      const { error } = await db()
        .from("user_favorites")
        .insert({ user_id: userId, ticker: f.ticker, market: f.market, added_at: new Date(f.addedAt).toISOString() });
      if (error && error.code !== "23505" && error.code !== "23503") throw error;
    }
  }
  return listFavorites(userId);
}
