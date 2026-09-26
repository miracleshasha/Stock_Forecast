-- ============================================================
-- 계정별 즐겨찾기 (2026-09-27)
-- 로그인한 사용자의 즐겨찾기를 저장합니다. 비로그인 사용자는 여전히
-- 브라우저(localStorage)에 저장하고, 로그인하면 계정으로 합쳐집니다.
--
-- 접근은 웹 서버(서비스 롤)만 합니다. 서버가 쿠키의 세션으로 사용자를
-- 확인한 뒤 그 user_id 로만 읽고 씁니다. 그래서 RLS 는 켜되 정책은 두지
-- 않습니다(= anon/authenticated 키로는 읽을 수도 쓸 수도 없음).
-- ============================================================
CREATE TABLE IF NOT EXISTS user_favorites (
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticker    TEXT NOT NULL REFERENCES symbols(ticker) ON DELETE CASCADE,
  market    TEXT NOT NULL,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticker)
);

ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
