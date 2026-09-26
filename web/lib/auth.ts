// ============================================================
// SignalDesk — 회원 인증 (서버 전용)
//
// 전화번호 + 비밀번호. Supabase Auth 는 이메일 기준이라 전화번호를
// `01012345678@<앱 도메인>` 로 바꿔 넘깁니다(study-planner 와 같은 방식).
// 받을 수 없는 주소이므로 가입은 서버에서 관리자 API 로 "확인된 사용자"로
// 만들고(확인 메일 없음), 세션 토큰은 httpOnly 쿠키에만 둡니다.
// 브라우저에는 Supabase 키가 나가지 않습니다.
// ============================================================

import "server-only";
import { createClient, type Session, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { formatPhone, maskPhone, normalizePhone } from "./phone";

const ID_DOMAIN = "stock-forecast-59po.vercel.app";

export const COOKIE = {
  access: "sd_at",
  refresh: "sd_rt",
  /** 화면 표시용 마스킹 번호. 인증에는 쓰지 않습니다(httpOnly 아님). */
  who: "sd_who",
} as const;

// 자동 로그인 유지 기간. 쓸 때마다(토큰 갱신 시) 다시 늘어납니다.
// 400일은 브라우저가 허용하는 쿠키 최대 수명입니다.
const REFRESH_MAX_AGE = 60 * 60 * 24 * 400;

export const phoneToEmail = (phone: string) => `${normalizePhone(phone)}@${ID_DOMAIN}`;
export const emailToPhone = (email: string | undefined) =>
  email ? formatPhone(email.split("@")[0]) : "";

/**
 * 인증 전용 클라이언트를 요청마다 새로 만듭니다.
 * 데이터 조회용 공유 클라이언트(getSupabase)에 로그인하면 그 세션이 다른
 * 사용자의 요청에까지 섞이므로, 절대 같은 인스턴스를 쓰지 않습니다.
 */
function authClient() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase 환경변수가 없습니다");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export type AuthResult = { ok: true; session: Session } | { ok: false; status: number; message: string };

export async function signUp(phone: string, password: string): Promise<AuthResult> {
  const { error } = await authClient().auth.admin.createUser({
    email: phoneToEmail(phone),
    password,
    email_confirm: true,
    user_metadata: { phone: normalizePhone(phone) },
  });
  if (error) {
    if (error.code === "email_exists" || error.code === "user_already_exists" || /already/i.test(error.message)) {
      return { ok: false, status: 409, message: "이미 가입된 번호예요. 로그인해 주세요." };
    }
    if (error.code === "weak_password") {
      return { ok: false, status: 400, message: "비밀번호가 너무 단순해요. 다른 비밀번호를 써 주세요." };
    }
    console.error("[auth] signUp", error.code, error.message);
    return { ok: false, status: 500, message: "계정을 만들지 못했어요. 잠시 뒤 다시 시도해 주세요." };
  }
  return signIn(phone, password);
}

export async function signIn(phone: string, password: string): Promise<AuthResult> {
  const { data, error } = await authClient().auth.signInWithPassword({
    email: phoneToEmail(phone),
    password,
  });
  if (error || !data.session) {
    if (error?.code === "invalid_credentials" || /invalid login/i.test(error?.message ?? "")) {
      return { ok: false, status: 401, message: "전화번호 또는 비밀번호가 맞지 않아요." };
    }
    if (error?.code === "over_request_rate_limit") {
      return { ok: false, status: 429, message: "시도가 너무 많아요. 잠시 뒤 다시 시도해 주세요." };
    }
    console.error("[auth] signIn", error?.code, error?.message);
    return { ok: false, status: 500, message: "로그인하지 못했어요. 잠시 뒤 다시 시도해 주세요." };
  }
  return { ok: true, session: data.session };
}

/** 리프레시 토큰으로 새 세션. 만료·폐기된 토큰이면 null. */
export async function refresh(refreshToken: string): Promise<Session | null> {
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: refreshToken });
  return error ? null : data.session;
}

/** 세션을 서버에서 폐기(이 기기의 리프레시 토큰 무효화). 실패해도 쿠키는 지웁니다. */
export async function revoke(accessToken: string): Promise<void> {
  try {
    await authClient().auth.admin.signOut(accessToken, "local");
  } catch (e) {
    console.warn("[auth] revoke failed", e);
  }
}

// ---------- 쿠키 ----------
type CookieJar = {
  set: (name: string, value: string, opts: Record<string, unknown>) => unknown;
};

const base = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
});

export function writeSessionCookies(jar: CookieJar, session: Session) {
  jar.set(COOKIE.access, session.access_token, { ...base(), maxAge: session.expires_in });
  jar.set(COOKIE.refresh, session.refresh_token, { ...base(), maxAge: REFRESH_MAX_AGE });
  const phone = session.user?.user_metadata?.phone ?? emailToPhone(session.user?.email);
  jar.set(COOKIE.who, encodeURIComponent(maskPhone(phone)), {
    ...base(),
    httpOnly: false,
    maxAge: REFRESH_MAX_AGE,
  });
}

export function clearSessionCookies(jar: CookieJar) {
  for (const name of Object.values(COOKIE)) jar.set(name, "", { ...base(), maxAge: 0 });
}

/** 로컬 검증을 못 하는 토큰(구형 HS256)용: Supabase 에 직접 확인 */
export async function userIdFromSupabase(accessToken: string): Promise<string | null> {
  const { data, error } = await authClient().auth.getUser(accessToken);
  return error ? null : data.user.id;
}

// ---------- 현재 사용자 ----------
/** 액세스 토큰을 Supabase 에 확인해 사용자를 돌려줍니다(위조된 쿠키 방지). */
export async function getSessionUser(): Promise<User | null> {
  const token = (await cookies()).get(COOKIE.access)?.value;
  if (!token) return null;
  const { data, error } = await authClient().auth.getUser(token);
  return error ? null : data.user;
}

/**
 * 현재 사용자 id. 액세스 토큰 서명을 로컬(JWKS)로 검증해 네트워크 왕복을 줄입니다.
 * 구형 HS256 토큰이면 Supabase 에 확인합니다.
 */
export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE.access)?.value;
  if (!token) return null;
  const { verifyAccessToken } = await import("./jwt");
  const v = await verifyAccessToken(token).catch(() => null);
  if (v === "unsupported") return userIdFromSupabase(token);
  return v?.sub ?? null;
}

/** 상단 바 등에 쓰는 표시용 이름(검증 없음). 로그인 여부 판단에 쓰지 마세요. */
export async function getDisplayWho(): Promise<string | null> {
  const v = (await cookies()).get(COOKIE.who)?.value;
  return v ? decodeURIComponent(v) : null;
}
