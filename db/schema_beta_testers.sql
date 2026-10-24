-- ============================================================
-- 베타 테스터 명단 (2026-10-24)
--   배포 전 새 기능을 허락한 사용자에게만 보여줄 때 씁니다(web/lib/beta.ts isBeta()).
--   서버(service key) 전용 — anon/authenticated 는 읽을 수 없습니다.
--
--   추가: INSERT INTO beta_testers (user_id, phone, note)
--         SELECT id, '010xxxxxxxx', '메모' FROM auth.users
--         WHERE email = '010xxxxxxxx@stock-forecast-59po.vercel.app' ON CONFLICT DO NOTHING;
--   삭제: DELETE FROM beta_testers WHERE phone = '010xxxxxxxx';
--   웹은 명단을 1분 캐시하므로 1분 안에 반영됩니다.
-- ============================================================
CREATE TABLE IF NOT EXISTS beta_testers (
  user_id   UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone     TEXT,              -- 확인용(판정은 user_id 로)
  note      TEXT,
  added_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE beta_testers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON beta_testers FROM anon, authenticated;
