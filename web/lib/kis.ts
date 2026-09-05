// ============================================================
// SignalDesk — KIS 현재가 조회 (서버 전용)
//
// 이 파일만 예외적으로 요청 시점에 외부 API를 호출합니다. 다만 계산은 하지
// 않습니다 — 판정 점수·지표는 배치가 확정 일봉으로 채워둔 값 그대로 쓰고,
// 여기서 얻은 현재가는 화면 상단 숫자에만 얹습니다.
// daily_prices 에는 절대 쓰지 않습니다(미완성 봉이 섞이면 지표가 오염됨).
//
// 토큰은 발급하지 않고 배치가 kis_token 에 넣어둔 것을 읽어 씁니다.
// ============================================================

import { getSupabase } from "./supabase";
import type { Currency, LiveQuote, Market } from "./types";

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

  if (error || !data) return null; // 테이블 미생성/미발급 → 종가로 폴백

  const expiresAt = new Date(data.expires_at as string).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now + 60_000) return null;

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
): Promise<LiveQuote | null> {
  if (!isKisConfigured()) return null;

  let price: number | null = null;
  let prevClose: number | null = null;

  try {
    if (currency === "KRW") {
      const out = await call(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "FHKST01010100",
        { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: ticker },
      );
      if (!out) return null;
      price = num(out.stck_prpr);      // 현재가
      prevClose = num(out.stck_sdpr);  // 전일 종가
    } else {
      const out = await call(
        "/uapi/overseas-price/v1/quotations/price",
        "HHDFS00000300",
        { AUTH: "", EXCD: EXCD_BY_MARKET[market] ?? "NAS", SYMB: ticker },
      );
      if (!out) return null;
      price = num(out.last);   // 현재가
      prevClose = num(out.base); // 전일 종가
    }
  } catch {
    return null; // 타임아웃·네트워크 오류 → 종가 폴백
  }

  if (price == null || price <= 0) return null;

  const change = prevClose != null ? price - prevClose : 0;
  const changePct =
    prevClose != null && prevClose > 0 ? (change / prevClose) * 100 : 0;

  return { price, prevClose, change, changePct, fetchedAt: new Date().toISOString() };
}
