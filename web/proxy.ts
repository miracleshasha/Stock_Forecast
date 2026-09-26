import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE,
  clearSessionCookies,
  refresh,
  userIdFromSupabase,
  writeSessionCookies,
} from "@/lib/auth";
import { peekExp, verifyAccessToken } from "@/lib/jwt";

/** 로그인 없이 열리는 경로 */
const PUBLIC = [/^\/login$/, /^\/api\/auth\//];

async function isValid(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const v = await verifyAccessToken(token);
    if (v === "unsupported") return (await userIdFromSupabase(token)) != null;
    return v != null;
  } catch (e) {
    console.error("[proxy] token verify failed", e);
    return false;
  }
}

function denied(req: NextRequest): NextResponse {
  const { pathname, search } = req.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ message: "로그인이 필요해요." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = pathname + search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/**
 * 로그인 게이트 + 자동 로그인.
 * 1) 액세스 토큰이 유효하면 통과
 * 2) 없거나 곧 만료면 리프레시 토큰(최대 400일 보관)으로 새로 발급해 통과
 * 3) 둘 다 안 되면 페이지는 /login 으로, API 는 401
 */
export async function proxy(req: NextRequest) {
  const isPublic = PUBLIC.some((re) => re.test(req.nextUrl.pathname));
  const at = req.cookies.get(COOKIE.access)?.value;
  const rt = req.cookies.get(COOKIE.refresh)?.value;

  const fresh = at != null && peekExp(at) - Date.now() / 1000 > 60;
  if (fresh && (await isValid(at))) return NextResponse.next();

  if (rt) {
    const session = await refresh(rt);
    if (session) {
      // 이번 요청의 서버 렌더도 새 토큰을 보도록 요청 쿠키까지 바꿔 넘깁니다
      req.cookies.set(COOKIE.access, session.access_token);
      req.cookies.set(COOKIE.refresh, session.refresh_token);
      const res = NextResponse.next({ request: { headers: req.headers } });
      writeSessionCookies(res.cookies, session);
      return res;
    }
  }

  // 로그인 상태가 아님 — 남은 쿠키 정리
  const res = isPublic ? NextResponse.next() : denied(req);
  if (at || rt || req.cookies.get(COOKIE.who)) clearSessionCookies(res.cookies);
  return res;
}

export const config = {
  // 정적 파일만 제외하고 전부(페이지 + 데이터 API) 게이트를 거칩니다
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
