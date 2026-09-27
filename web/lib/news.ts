// ============================================================
// 뉴스 (네이버 검색 API — 공식 · 무료 키)
//
// 기사 본문은 가져오지 않습니다. 제목·언론사·시각만 보여주고 원문 링크로 보냅니다
// (저작권: 요약문도 싣지 않음). 키가 없거나 호출이 실패하면 빈 목록 → 화면에서 카드를 숨깁니다.
// 같은 검색어는 30분 캐시합니다(하루 25,000회 한도).
// ============================================================

import "server-only";
import { unstable_cache } from "next/cache";

export interface NewsItem {
  title: string;
  url: string;
  /** 언론사 도메인(예: hankyung.com) */
  source: string;
  publishedAt: string; // ISO
}

const ENTITIES: Record<string, string> = { "&quot;": '"', "&amp;": "&", "&lt;": "<", "&gt;": ">", "&apos;": "'", "&#39;": "'", "&nbsp;": " " };

function clean(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&(quot|amp|lt|gt|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|news|n)\./, "");
  } catch {
    return "";
  }
}

async function fetchNews(query: string, display: number, sort: "date" | "sim" = "date"): Promise<NewsItem[]> {
  const id = process.env.NAVER_CLIENT_ID;
  const secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret) return [];
  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.searchParams.set("query", query);
  url.searchParams.set("display", String(display));
  url.searchParams.set("sort", sort);
  const res = await fetch(url, {
    headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
    cache: "no-store",
  });
  if (!res.ok) {
    console.error(`[news] 네이버 검색 실패 ${res.status}`, (await res.text()).slice(0, 200));
    return [];
  }
  const body = (await res.json()) as {
    items?: { title: string; originallink?: string; link: string; pubDate: string }[];
  };
  return (body.items ?? []).map((it) => {
    const link = it.originallink || it.link;
    return {
      title: clean(it.title),
      url: link,
      source: domainOf(link),
      publishedAt: new Date(it.pubDate).toISOString(),
    };
  });
}

const cachedNews = unstable_cache(fetchNews, ["naver-news-v2"], { revalidate: 1800 });

/** 제목이 거의 같은 기사(여러 언론사 전재)는 하나만 남깁니다 */
function dedupe(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((n) => {
    const key = n.title.replace(/[^가-힣a-zA-Z0-9]/g, "").slice(0, 24);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * 종목 관련 뉴스. 종목명으로 '정확도순' 검색 → 제목에 종목명이 있는 최근 30일 기사만 → 최신순.
 * (날짜순 검색은 시장 전반 기사가 섞여 제목에 종목명이 있는 비율이 크게 낮았음 — 삼성전자 20건 중 1건)
 * 맞는 기사가 없으면 엉뚱한 기사를 보여주느니 빈 목록(카드 숨김)을 돌려줍니다.
 */
export async function getStockNews(name: string, limit = 5): Promise<NewsItem[]> {
  try {
    // "에이엠디(AMD)", "티에스엠씨(TSMC)" 처럼 괄호가 있으면 기사에서 더 흔히 쓰는 괄호 안 표기로 검색하고,
    // 제목은 두 표기 중 하나만 있어도 인정합니다
    const m = /^(.*?)\s*\((.+)\)\s*$/.exec(name);
    const main = (m ? m[1] : name).trim() || name;
    const query = m ? m[2].trim() : main;
    const keys = [main, m?.[2]].filter(Boolean).map((k) => k!.replace(/\s+/g, "").toLowerCase());
    const hay = (t: string) => t.replace(/\s+/g, "").toLowerCase();
    const items = dedupe(await cachedNews(query, 50, "sim"));
    const since = Date.now() - 30 * 864e5;
    return items
      .filter((n) => keys.some((k) => hay(n.title).includes(k)))
      .filter((n) => Date.parse(n.publishedAt) >= since)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  } catch (e) {
    console.error("[news] getStockNews", e);
    return [];
  }
}

/** 홈 시장 뉴스: 국내 증시 + 미국 증시 */
export async function getMarketNews(limit = 5): Promise<NewsItem[]> {
  try {
    const [kr, us] = await Promise.all([cachedNews("코스피 마감", 10), cachedNews("뉴욕증시 마감", 10)]);
    return dedupe([...kr, ...us])
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  } catch (e) {
    console.error("[news] getMarketNews", e);
    return [];
  }
}
