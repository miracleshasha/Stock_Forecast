-- ============================================================
-- 지수 구성종목 변경 이력 (2026-10-24)
--   생존편향을 줄이려고 "그날 기준 지수에 들어 있던 종목"을 날짜 구간으로 남깁니다.
--   batch/membership.py 가 배치마다 현재 구성을 받아 바뀐 것만 기록합니다.
--     편입: 새 행(valid_from = 확인한 날, valid_to = NULL)
--     편출: 열린 행의 valid_to = 확인한 날(그날부터 빠짐)
--   첫 기록일(2026-10-24) 이전의 구성은 알 수 없으므로, 그 전 구간은 백테스트에서
--   여전히 생존편향이 있다고 보고 해석해야 합니다.
-- ============================================================
CREATE TABLE IF NOT EXISTS universe_membership (
  index_name  TEXT NOT NULL,          -- 'KOSPI200' | 'KOSDAQ150' | 'SP500'
  ticker      TEXT NOT NULL,
  name        TEXT,
  valid_from  DATE NOT NULL,
  valid_to    DATE,                   -- NULL = 현재 편입 중 (구간은 [valid_from, valid_to))
  PRIMARY KEY (index_name, ticker, valid_from)
);
CREATE INDEX IF NOT EXISTS universe_membership_open
  ON universe_membership (index_name) WHERE valid_to IS NULL;

-- 서버(배치·service key) 전용: 정책을 두지 않아 anon/authenticated 는 읽을 수 없습니다
ALTER TABLE universe_membership ENABLE ROW LEVEL SECURITY;
