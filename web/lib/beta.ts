// ============================================================
// 베타 기능 게이트 (서버 전용)
//
// 배포 전 새 기능은 beta_testers 명단에 있는 사용자에게만 보여줍니다.
// 판정은 서명이 검증된 액세스 토큰의 사용자 id 로 합니다(표시용 쿠키 sd_who 는 쓰지 않음).
// 명단은 1분 캐시 — SQL 로 추가·삭제하면 1분 안에 반영됩니다(db/schema_beta_testers.sql).
// 기능을 전체 공개할 때는 해당 화면의 isBeta() 조건만 지우면 됩니다.
// ============================================================

import "server-only";
import { unstable_cache } from "next/cache";
import { getSessionUserId } from "./auth";
import { getSupabase } from "./supabase";

const getBetaIds = unstable_cache(
  async (): Promise<string[]> => {
    const sb = getSupabase();
    if (!sb) return [];
    const { data, error } = await sb.from("beta_testers").select("user_id");
    if (error) throw error; // 실패는 캐시하지 않음 → isBeta 가 false 로 처리
    return (data ?? []).map((r) => r.user_id as string);
  },
  ["beta-testers-v1"],
  { revalidate: 60 },
);

/** 현재 로그인 사용자가 베타 명단에 있으면 true. 조회 실패 시 false(새 기능 숨김 쪽으로 실패). */
export async function isBeta(): Promise<boolean> {
  const uid = await getSessionUserId().catch(() => null);
  if (!uid) return false;
  const ids = await getBetaIds().catch(() => [] as string[]);
  return ids.includes(uid);
}
