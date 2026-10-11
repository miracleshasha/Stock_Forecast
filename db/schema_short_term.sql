-- ============================================================
-- 단기 신호 (2026-10-11)
--   daily_signals.short_term : 그날 봉 기준 캔들 패턴·가격위치×거래량 요약 (batch/patterns.py)
--   pattern_stats            : 패턴별 실측(다음 1·5거래일 수익률, 같은 시장 '아무 날' 평균과 비교)
--                              batch/pattern_backtest.py 가 토요일 전량 배치 때 다시 계산
-- ============================================================
ALTER TABLE daily_signals ADD COLUMN IF NOT EXISTS short_term JSONB;

CREATE TABLE IF NOT EXISTS pattern_stats (
  pattern      TEXT NOT NULL,
  region       TEXT NOT NULL,      -- 'KR' | 'US'
  n            INTEGER NOT NULL,   -- 발생 횟수(종목×날짜)
  n_days       INTEGER NOT NULL,   -- 발생한 서로 다른 날짜 수(표준오차의 표본 단위)
  ret1         NUMERIC,            -- 다음 1거래일 평균 수익률(%)
  ret5         NUMERIC,            -- 다음 5거래일 평균 수익률(%)
  win5         NUMERIC,            -- 5거래일 뒤 오른 비율(0~1)
  base_ret1    NUMERIC,            -- 같은 시장 아무 날 평균
  base_ret5    NUMERIC,
  base_win5    NUMERIC,
  excess5      NUMERIC,            -- ret5 - base_ret5 (%p)
  se5          NUMERIC,            -- excess5 의 표준오차(날짜 단위)
  period_from  TEXT,
  period_to    TEXT,
  computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (pattern, region)
);
ALTER TABLE pattern_stats ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='pattern_stats' AND policyname='public_read') THEN
    CREATE POLICY public_read ON pattern_stats FOR SELECT USING (true);
  END IF;
END $$;
