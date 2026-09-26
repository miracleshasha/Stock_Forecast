// ============================================================
// SignalDesk — 즐겨찾기 (브라우저)
//
// 비로그인: localStorage(sd.favorites)에 저장.
// 로그인:   계정(user_favorites)에 저장. 처음 불러올 때 브라우저에 있던
//           즐겨찾기를 계정으로 합치고 브라우저 쪽은 비웁니다.
// 최대 20종목. 바뀌면 FAVORITES_EVENT 를 쏴서 화면들이 다시 읽습니다.
// ============================================================

"use client";

import type { FavoriteItem, Market } from "./types";

const KEY = "sd.favorites";
const MAX = 20;
const EVENT = "sd-favorites-changed";

export const FAVORITES_EVENT = EVENT;
export const FAVORITES_MAX = MAX;

// ---------- 모드 ----------
/** 표시용 쿠키(sd_who)로 로그인 여부를 판단합니다. 실제 권한 확인은 서버가 합니다. */
function loggedIn(): boolean {
  return typeof document !== "undefined" && /(?:^|;\s*)sd_who=[^;]+/.test(document.cookie);
}

/** 계정 목록 캐시. null = 아직 안 불러옴 */
let remote: FavoriteItem[] | null = null;
let loading: Promise<FavoriteItem[]> | null = null;
/** 서버가 401 을 주면(세션 만료) 이번 페이지에서는 브라우저 저장으로 돌아갑니다 */
let remoteBroken = false;

const accountMode = () => loggedIn() && !remoteBroken;
const notify = () => window.dispatchEvent(new Event(EVENT));

// ---------- 브라우저 저장 ----------
function readLocal(): FavoriteItem[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x) => x && typeof x.ticker === "string") : [];
  } catch {
    return [];
  }
}

function writeLocal(items: FavoriteItem[]) {
  try {
    if (items.length) window.localStorage.setItem(KEY, JSON.stringify(items));
    else window.localStorage.removeItem(KEY);
  } catch {}
}

// ---------- 서버 ----------
async function api(path: string, init?: RequestInit): Promise<FavoriteItem[]> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (res.status === 401) {
    remoteBroken = true;
    remote = null;
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? "즐겨찾기를 저장하지 못했어요.");
  }
  return (await res.json()) as FavoriteItem[];
}

// ---------- 공개 API ----------
/** 현재 목록(동기). 로그인 상태에서 아직 안 불러왔으면 빈 목록 — loadFavorites() 로 채우세요. */
export function getFavorites(): FavoriteItem[] {
  return accountMode() ? remote ?? [] : readLocal();
}

export function isFavorite(ticker: string): boolean {
  return getFavorites().some((f) => f.ticker === ticker);
}

/** 계정 목록을 불러옵니다(한 페이지에서 여러 번 불러도 요청은 한 번). */
export function loadFavorites(): Promise<FavoriteItem[]> {
  if (!accountMode()) return Promise.resolve(readLocal());
  if (remote) return Promise.resolve(remote);
  if (!loading) {
    const local = readLocal();
    loading = (local.length
      ? api("/api/me/favorites/merge", { method: "POST", body: JSON.stringify({ items: local }) }).then((list) => {
          writeLocal([]); // 계정으로 옮겼으니 브라우저 쪽은 비웁니다
          return list;
        })
      : api("/api/me/favorites"))
      .then((list) => {
        remote = list;
        notify();
        return list;
      })
      .catch(() => {
        // 서버 장애·세션 만료: 이번 페이지에서는 브라우저 저장으로 동작하고
        // 다음 방문 때 다시 합칩니다
        remoteBroken = true;
        notify();
        return readLocal();
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** 로그인·로그아웃 직후 캐시를 버립니다. */
export function resetFavorites() {
  remote = null;
  loading = null;
  remoteBroken = false;
  if (typeof window !== "undefined") notify();
}

/**
 * 토글. 결과(즐겨찾기 여부)를 돌려줍니다. 한도 초과·실패면 Error 를 던집니다.
 * 계정 모드는 화면을 먼저 바꾸고(낙관적 갱신) 실패하면 되돌립니다.
 */
export async function toggleFavorite(ticker: string, market: Market): Promise<boolean> {
  const on = isFavorite(ticker);

  if (!accountMode()) {
    const items = readLocal();
    if (on) {
      writeLocal(items.filter((f) => f.ticker !== ticker));
    } else {
      if (items.length >= MAX) throw new Error(`즐겨찾기는 ${MAX}개까지 담을 수 있어요.`);
      writeLocal([...items, { ticker, market, addedAt: Date.now() }]);
    }
    notify();
    return !on;
  }

  await loadFavorites();
  const before = remote ?? [];
  if (!on && before.length >= MAX) throw new Error(`즐겨찾기는 ${MAX}개까지 담을 수 있어요.`);
  remote = on
    ? before.filter((f) => f.ticker !== ticker)
    : [...before, { ticker, market, addedAt: Date.now() }];
  notify();
  try {
    remote = on
      ? await api(`/api/me/favorites?ticker=${encodeURIComponent(ticker)}`, { method: "DELETE" })
      : await api("/api/me/favorites", { method: "POST", body: JSON.stringify({ ticker, market }) });
    notify();
    return !on;
  } catch (e) {
    if (!remoteBroken) remote = before;
    notify();
    throw e;
  }
}

export async function removeFavorite(ticker: string): Promise<void> {
  if (isFavorite(ticker)) await toggleFavorite(ticker, "KOSPI");
}

/** 지금 즐겨찾기가 계정에 저장되는지(화면 안내 문구용) */
export function favoritesInAccount(): boolean {
  return accountMode();
}
