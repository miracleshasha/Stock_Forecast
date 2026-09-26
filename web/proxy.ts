import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, clearSessionCookies, refresh, writeSessionCookies } from "@/lib/auth";

/** JWT 의 exp(초). 서명 검증은 하지 않습니다 — 갱신 시점을 정하는 용도로만 씁니다. */
function expOf(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * 로그인 유지: 액세스 토큰(1시간)이 없거나 곧 만료되면 리프레시 토큰으로 갱신해
 * 쿠키를 새로 씁니다. 서버 컴포넌트는 쿠키를 쓸 수 없어서 여기서 처리합니다.
 */
export async function proxy(req: NextRequest) {
  const rt = req.cookies.get(COOKIE.refresh)?.value;
  if (!rt) return NextResponse.next();

  const at = req.cookies.get(COOKIE.access)?.value;
  if (at && expOf(at) - Date.now() / 1000 > 60) return NextResponse.next();

  const session = await refresh(rt);
  if (!session) {
    // 폐기·만료된 리프레시 토큰 → 로그아웃 상태로 정리
    for (const name of Object.values(COOKIE)) req.cookies.delete(name);
    const res = NextResponse.next({ request: { headers: req.headers } });
    clearSessionCookies(res.cookies);
    return res;
  }

  // 이번 요청의 서버 렌더도 새 토큰을 보도록 요청 쿠키까지 바꿔 넘깁니다
  req.cookies.set(COOKIE.access, session.access_token);
  req.cookies.set(COOKIE.refresh, session.refresh_token);
  const res = NextResponse.next({ request: { headers: req.headers } });
  writeSessionCookies(res.cookies, session);
  return res;
}

export const config = {
  // 정적 파일·이미지·차트/시세 API 는 제외 (로그인과 무관, 호출이 잦음)
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/stock|api/search|api/macro|api/favorites).*)"],
};
