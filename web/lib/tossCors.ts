// ============================================================
// 앱인토스 미니앱 → /api/toss/* 다른 주소 접근 허용(CORS). proxy.ts 에서 씁니다.
//
// 미니앱 Origin (앱인토스 서버 API 문서 기준)
//   SDK 3.1 이상: https://<appName>.apps.tossmini.com / https://<appName>.private-apps.tossmini.com(QR 테스트)
//   SDK 3.0.x   : https://<appName>.web.tossmini.com  / https://<appName>.private-web.tossmini.com
// 로컬 개발 주소는 TOSS_DEV_ORIGINS(쉼표 구분, 예: http://localhost:5173)로 추가합니다.
// ============================================================

const APP = process.env.TOSS_APP_NAME || "stock-forecast";

const ALLOWED = new Set([
  `https://${APP}.apps.tossmini.com`,
  `https://${APP}.private-apps.tossmini.com`,
  `https://${APP}.web.tossmini.com`,
  `https://${APP}.private-web.tossmini.com`,
  ...(process.env.TOSS_DEV_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
]);

export const isTossApi = (pathname: string) => pathname.startsWith("/api/toss/");

/** 허용된 Origin 이면 그 값을, 아니면 null */
export function allowedOrigin(origin: string | null): string | null {
  return origin && ALLOWED.has(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const ok = allowedOrigin(origin);
  return {
    Vary: "Origin",
    ...(ok
      ? {
          "Access-Control-Allow-Origin": ok,
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        }
      : {}),
  };
}
