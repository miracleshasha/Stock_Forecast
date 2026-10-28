import { NextResponse, type NextRequest } from "next/server";
import {
  COOKIE,
  clearSessionCookies,
  refresh,
  userIdFromSupabase,
  writeSessionCookies,
} from "@/lib/auth";
import { peekExp, verifyAccessToken } from "@/lib/jwt";
import { corsHeaders, isTossApi } from "@/lib/tossCors";

/**
 * 전화번호 입력이 필요한 경로. 나머지(홈·종목·뉴스·검색 등)는 누구나 바로 씁니다.
 * 즐겨찾기 화면과 계정 즐겨찾기 API, 내 정보만 막습니다.
 * (/research 는 화면에서 지정 계정만 열고 나머지는 404 — 게이트 밖에 둡니다)
 */
const PROTECTED = [/^\/favorites(\/|$)/, /^\/account(\/|$)/, /^\/api\/me\//];

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
    return NextResponse.json({ message: "전화번호를 입력해 주세요." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = pathname + search;
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

/**
 * 자동 로그인 + 즐겨찾기 게이트.
 * 1) 액세스 토큰이 유효하면 통과
 * 2) 없거나 곧 만료면 리프레시 토큰(최대 400일 보관)으로 새로 발급해 통과
 * 3) 둘 다 안 되면 보호 경로만 막습니다(페이지는 /login, API 는 401). 나머지는 그냥 통과
 */
export async function proxy(req: NextRequest) {
  // 앱인토스 미니앱 API: 로그인 없이 열고(판정 점수 없는 정보만 응답) 미니앱 주소에만 CORS 허용
  if (isTossApi(req.nextUrl.pathname)) {
    const headers = corsHeaders(req.headers.get("origin"));
    if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers });
    const res = NextResponse.next();
    for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
    return res;
  }

  const isProtected = PROTECTED.some((re) => re.test(req.nextUrl.pathname));
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
  const res = isProtected ? denied(req) : NextResponse.next();
  if (at || rt || req.cookies.get(COOKIE.who)) clearSessionCookies(res.cookies);
  return res;
}

export const config = {
  // 정적 파일만 제외하고 전부 거칩니다 — 로그인한 사람은 어느 화면에서든 토큰이 갱신되도록.
  // manifest·아이콘도 제외: 홈 화면 앱을 띄울 때마다 불리는데 토큰 검증이 필요 없습니다.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-[^/]*\\.png).*)",
  ],
};
