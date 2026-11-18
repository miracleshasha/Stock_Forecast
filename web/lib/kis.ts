// ============================================================
// SignalDesk — KIS 현재가 조회 (서버 전용)
//
// 이 파일만 예외적으로 요청 시점에 외부 API를 호출합니다. 다만 계산은 하지
// 않습니다 — 판정 점수·지표는 배치가 확정 일봉으로 채워둔 값 그대로 쓰고,
// 여기서 얻은 현재가는 화면 상단 숫자에만 얹습니다.
// daily_prices 에는 절대 쓰지 않습니다(미완성 봉이 섞이면 지표가 오염됨).
//
// 토큰은 배치가 kis_token 에 넣어둔 것을 읽어 씁니다. 배치가 멈춰 토큰이 만료된
// 경우에만 서버가 직접 발급해 kis_token 에 다시 넣습니다(2026-11, 아래 issueToken).
// ============================================================

import { getSupabase } from "./supabase";
import type { Currency, LiveQuote, Market, QuoteSkipReason } from "./types";

const BASE_URL =
  process.env.KIS_BASE_URL ?? "https://openapi.koreainvestment.com:9443";
const APP_KEY = process.env.KIS_APP_KEY ?? "";
const APP_SECRET = process.env.KIS_APP_SECRET ?? "";

const EXCD_BY_MARKET: Record<string, string> = {
  NASDAQ: "NAS",
  NYSE: "NYS",
  AMEX: "AMS",
};

export function isKisConfigured(): boolean {
  return Boolean(APP_KEY && APP_SECRET);
}

// ---------- 토큰 ----------
let memo: { token: string; expiresAt: number } | null = null;

// KIS 는 토큰 발급에 분당 제한이 있습니다. 서버리스는 인스턴스가 여러 개라
//  - 같은 인스턴스: 발급을 시도한 뒤 70초 동안은 다시 시도하지 않고
//  - 인스턴스끼리: kis_token.updated_at 을 먼저 바꾼(선점한) 요청 하나만 발급합니다.
const ISSUE_GAP_MS = 70_000;
let lastIssueTry = 0;

type Sb = NonNullable<ReturnType<typeof getSupabase>>;

/**
 * 배치 토큰이 없거나 만료됐을 때의 대비책. 실패하면 null → 호출자는 확정 종가를 보여줍니다.
 * @param hasRow kis_token 행이 있는지(선점은 행이 있을 때만 걸 수 있음)
 */
async function issueToken(sb: Sb, hasRow: boolean): Promise<string | null> {
  const now = Date.now();
  if (now - lastIssueTry < ISSUE_GAP_MS) return null;
  lastIssueTry = now;

  if (hasRow) {
    const { data: claimed, error } = await sb
      .from("kis_token")
      .update({ updated_at: new Date(now).toISOString() })
      .eq("id", 1)
      .lt("updated_at", new Date(now - ISSUE_GAP_MS).toISOString())
      .select("id");
    if (error) {
      console.warn("[kis] 토큰 발급 선점 실패:", error.message);
      return null;
    }
    if (!claimed?.length) return null; // 다른 요청이 방금 발급 중 — 이번엔 종가로
  }

  try {
    const res = await fetch(`${BASE_URL}/oauth2/tokenP`, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ grant_type: "client_credentials", appkey: APP_KEY, appsecret: APP_SECRET }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn("[kis] 토큰 발급 실패: HTTP", res.status);
      return null;
    }
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    const token = typeof body.access_token === "string" ? body.access_token : "";
    if (!token) {
      console.warn("[kis] 토큰 발급 응답에 access_token 없음");
      return null;
    }
    const expiresAt = Date.now() + (Number(body.expires_in) || 86400) * 1000;
    const { error } = await sb.from("kis_token").upsert(
      {
        id: 1,
        access_token: token,
        expires_at: new Date(expiresAt).toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) console.warn("[kis] 새 토큰 저장 실패(이 인스턴스에서만 사용):", error.message);
    memo = { token, expiresAt };
    console.warn("[kis] 배치 토큰이 없거나 만료돼 서버에서 새로 발급했습니다 — 배치 상태를 확인하세요");
    return token;
  } catch (e) {
    console.warn("[kis] 토큰 발급 실패:", e);
    return null;
  }
}

async function getToken(): Promise<string | null> {
  const now = Date.now();
  if (memo && memo.expiresAt > now + 60_000) return memo.token;

  const sb = getSupabase();
  if (!sb) return null;

  const { data, error } = await sb
    .from("kis_token")
    .select("access_token, expires_at")
    .eq("id", 1)
    .maybeSingle();

  // kis_token 은 RLS 정책을 두지 않아 서비스 롤 키로만 읽힙니다.
  // anon 키로 배포됐다면 여기서 조용히 막히므로 원인을 남깁니다.
  if (error) {
    console.warn("[kis] kis_token 조회 실패(서비스 롤 키인지 확인):", error.message);
    return null;
  }
  if (!data) {
    console.warn("[kis] kis_token 행 없음 — 서버에서 발급을 시도합니다");
    return issueToken(sb, false);
  }

  const expiresAt = new Date(data.expires_at as string).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 60_000) {
    console.warn("[kis] kis_token 만료됨:", data.expires_at, "— 서버에서 발급을 시도합니다");
    return issueToken(sb, true);
  }

  memo = { token: data.access_token as string, expiresAt };
  return memo.token;
}

// ---------- 조회 ----------
function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function call(
  path: string,
  trId: string,
  params: Record<string, string>,
): Promise<Record<string, unknown> | null> {
  const token = await getToken();
  if (!token) return null;

  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      authorization: `Bearer ${token}`,
      appkey: APP_KEY,
      appsecret: APP_SECRET,
      tr_id: trId,
      custtype: "P",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) return null;
  const body = await res.json();
  if (body?.rt_cd !== "0") return null;
  return (body.output ?? null) as Record<string, unknown> | null;
}

/**
 * 현재가 1건. 실패하면 null → 호출자는 확정 종가를 그대로 보여줍니다.
 * 등락은 전일 종가와의 차이로 직접 계산합니다(응답의 부호 표기가 국내/해외
 * 서로 달라서, 값에서 유도하는 편이 안전합니다).
 */
export async function fetchQuote(
  ticker: string,
  market: Market,
  currency: Currency,
): Promise<{ quote: LiveQuote | null; reason?: QuoteSkipReason }> {
  if (!isKisConfigured()) {
    console.warn("[kis] KIS_APP_KEY / KIS_APP_SECRET 미설정");
    return { quote: null, reason: "kis_not_configured" };
  }
  if (!(await getToken())) return { quote: null, reason: "no_token" };

  let price: number | null = null;
  let prevClose: number | null = null;

  try {
    if (currency === "KRW") {
      const out = await call(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "FHKST01010100",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: ticker },
      );
      if (!out) return { quote: null, reason: "kis_failed" };
      price = num(out.stck_prpr);      // 현재가
      prevClose = num(out.stck_sdpr);  // 전일 종가
    } else {
      const out = await call(
        "/uapi/overseas-price/v1/quotations/price",
        "HHDFS00000300",
        { AUTH: "", EXCD: EXCD_BY_MARKET[market] ?? "NAS", SYMB: ticker },
      );
      if (!out) return { quote: null, reason: "kis_failed" };
      price = num(out.last);   // 현재가
      prevClose = num(out.base); // 전일 종가
    }
  } catch (e) {
    console.warn(`[kis] ${ticker} 현재가 조회 실패:`, e); // 타임아웃·네트워크 오류
    return { quote: null, reason: "kis_failed" };
  }

  if (price == null || price <= 0) return { quote: null, reason: "kis_failed" };

  const change = prevClose != null ? price - prevClose : 0;
  const changePct =
    prevClose != null && prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    quote: { price, prevClose, change, changePct, fetchedAt: new Date().toISOString() },
  };
}
