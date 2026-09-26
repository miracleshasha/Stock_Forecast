// ============================================================
// Supabase 액세스 토큰 로컬 검증 (ES256 · JWKS)
//
// 로그인 게이트가 모든 요청에서 돌기 때문에, 매번 Supabase 에 묻지 않고
// 프로젝트 공개키로 서명·만료·발급자를 직접 확인합니다.
// 공개키는 /auth/v1/.well-known/jwks.json 에서 받아 10분간 캐시합니다.
// ============================================================

type Jwk = { kid?: string; kty: string; crv?: string; x?: string; y?: string; alg?: string };
export type AccessClaims = { sub: string; exp: number; role?: string; aud?: string | string[]; iss?: string };

const JWKS_TTL_MS = 10 * 60 * 1000;
let jwksCache: { at: number; keys: Jwk[] } | null = null;

function supabaseUrl(): string {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL 이 없습니다");
  return url.replace(/\/$/, "");
}

async function getJwks(force = false): Promise<Jwk[]> {
  if (!force && jwksCache && Date.now() - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetch(`${supabaseUrl()}/auth/v1/.well-known/jwks.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`JWKS ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  jwksCache = { at: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

const b64url = (s: string) => Buffer.from(s, "base64url");

/** 서명 검증 없이 exp 만 읽습니다(갱신 시점 판단용). */
export function peekExp(token: string): number {
  try {
    const payload = JSON.parse(b64url(token.split(".")[1]).toString());
    return typeof payload.exp === "number" ? payload.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * 서명·만료·발급자·대상을 확인합니다. 통과하면 클레임, 아니면 null.
 * ES256 이 아닌 토큰(구형 HS256 비밀키 서명)이면 "unsupported" 를 돌려주니
 * 호출자가 Supabase 에 직접 확인하세요.
 */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null | "unsupported"> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = JSON.parse(b64url(parts[0]).toString());
    claims = JSON.parse(b64url(parts[1]).toString());
  } catch {
    return null;
  }
  if (header.alg !== "ES256") return "unsupported";

  let keys = await getJwks();
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // 키 교체 직후일 수 있어 한 번 새로 받습니다
    keys = await getJwks(true);
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    b64url(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp <= now) return null;
  if (claims.iss && claims.iss !== `${supabaseUrl()}/auth/v1`) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes("authenticated")) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  return claims;
}
