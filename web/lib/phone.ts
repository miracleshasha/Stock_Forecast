// ============================================================
// 전화번호 아이디 — 서버/브라우저 공용
// 전화번호는 아이디로만 씁니다(문자 인증 없음).
// ============================================================

export const normalizePhone = (v: string) => String(v || "").replace(/\D/g, "");

/** 010으로 시작하는 휴대폰 번호(10~11자리) */
export const isValidPhone = (v: string) => /^01[0-9]{8,9}$/.test(normalizePhone(v));

/** 01012345678 → 010-1234-5678 (입력 중인 값도 자연스럽게) */
export function formatPhone(v: string): string {
  const d = normalizePhone(v).slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** 화면 표시용: 010-****-5678 */
export function maskPhone(v: string): string {
  const d = normalizePhone(v);
  if (d.length < 10) return formatPhone(d);
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}

export const PASSWORD_MIN = 6;
