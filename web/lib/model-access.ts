import "server-only";
import type { User } from "@supabase/supabase-js";
import { getSessionUser } from "./auth";

// 지정 번호의 기존 Auth 계정을 관리자 API로 대조했습니다.
// 전화번호·표시 쿠키·수정 가능한 user_metadata 대신 인증된 ID로 판정합니다.
const RESEARCH_USER_ID = "1cb6ce0b-c6a5-4cdc-a0b6-f49a4b916bcf";

export function canViewModelResearch(user: Pick<User, "id"> | null): boolean {
  return user?.id === RESEARCH_USER_ID;
}

/** 인증 서버가 확인한 지정 계정만 허용. 조회 실패 시 숨깁니다. */
export async function isModelResearchOwner(): Promise<boolean> {
  return canViewModelResearch(await getSessionUser().catch(() => null));
}
