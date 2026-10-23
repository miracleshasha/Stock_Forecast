-- ============================================================
-- 종목 종류 (2026-10-24, ETF 추가)
-- 'stock' | 'etf'. 홈의 시장 분위기·업종·순위 목록은 개별 종목만 집계하고, ETF 는 별도 탭으로 보여줍니다.
-- ============================================================
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'stock';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'symbols_kind_check') THEN
    ALTER TABLE symbols ADD CONSTRAINT symbols_kind_check CHECK (kind IN ('stock', 'etf'));
  END IF;
END $$;
