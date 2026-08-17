// ============================================================
// SignalDesk — 즐겨찾기 (1차: localStorage 기반, 로그인 없음)
// 키: sd.favorites, 최대 20종목
// ============================================================

"use client";

import type { FavoriteItem, Market } from "./types";

const KEY = "sd.favorites";
const MAX = 20;
const EVENT = "sd-favorites-changed";

export function getFavorites(): FavoriteItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.ticker === "string");
  } catch {
    return [];
  }
}

export function isFavorite(ticker: string): boolean {
  return getFavorites().some((f) => f.ticker === ticker);
}

function save(items: FavoriteItem[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

/** 토글 후 즐겨찾기 여부 반환. 최대치 초과 시 false 반환하고 추가 안 함 */
export function toggleFavorite(ticker: string, market: Market): boolean {
  const items = getFavorites();
  const idx = items.findIndex((f) => f.ticker === ticker);
  if (idx >= 0) {
    items.splice(idx, 1);
    save(items);
    return false;
  }
  if (items.length >= MAX) {
    save(items);
    return false;
  }
  items.push({ ticker, market, addedAt: Date.now() });
  save(items);
  return true;
}

export function removeFavorite(ticker: string) {
  const items = getFavorites().filter((f) => f.ticker !== ticker);
  save(items);
}

export const FAVORITES_EVENT = EVENT;
export const FAVORITES_MAX = MAX;
