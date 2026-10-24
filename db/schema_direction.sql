-- ============================================================
-- N일 뒤 방향 확률 (2026-10-24) — batch/direction_model.py
--   direction_models  : 시장(KR/US)×기간(5/10/20일)별 모델 계수·기준 확률·검증 성적·게이트(enabled)
--                       토요일 전량 배치가 다시 검증·학습해 덮어씁니다.
--   direction_latest  : 종목별 최신 예측(화면용, 종목당 1행). 근거(drivers) 포함
--   direction_history : 날짜별 예측 기록(실제 성적 추적용). 용량을 아끼려고 확률·구간 끝값만
-- ============================================================
CREATE TABLE IF NOT EXISTS direction_models (
  region        TEXT NOT NULL,             -- 'KR' | 'US'
  horizon       INTEGER NOT NULL,          -- 5 | 10 | 20 (거래일)
  enabled       BOOLEAN NOT NULL,          -- false 면 종목 차이 없이 기준 확률만 사용
  base          NUMERIC NOT NULL,          -- 학습 전 기간 같은 시장 N일 뒤 상승 비율
  features      JSONB NOT NULL,
  model         JSONB NOT NULL,            -- {mu, sd, beta}
  wf            JSONB,                     -- 워크포워드 검증 성적 {skill, skill_se, auc, cs_auc, cal[] ...}
  live          JSONB,                     -- 저장된 예측의 실제 성적
  range_q       JSONB,                     -- 변동성 5분위별 표준화 수익률 10·50·90% 분위수
  range_wf      JSONB,                     -- 범위 예측 워크포워드 성적 {coverage, coverage_by_vol, pinball_skill}
  trained_from  TEXT,
  trained_to    TEXT,
  trained_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (region, horizon)
);

CREATE TABLE IF NOT EXISTS direction_latest (
  ticker      TEXT PRIMARY KEY REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date  DATE NOT NULL,
  p5 REAL, p10 REAL, p20 REAL,
  base5 REAL, base10 REAL, base20 REAL,
  lo5 REAL, mid5 REAL, hi5 REAL,           -- N일 뒤 수익률 10·50·90% 분위(80% 구간 = lo~hi)
  lo10 REAL, mid10 REAL, hi10 REAL,
  lo20 REAL, mid20 REAL, hi20 REAL,
  drivers     JSONB,                       -- {"5": [[feature, logit 기여, 수준 부호], ...], ...} (모델이 켜진 기간만)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS direction_history (
  ticker      TEXT NOT NULL REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date  DATE NOT NULL,
  p5 REAL, p10 REAL, p20 REAL,
  lo5 REAL, hi5 REAL, lo10 REAL, hi10 REAL, lo20 REAL, hi20 REAL,
  PRIMARY KEY (ticker, trade_date)
);

ALTER TABLE direction_models  ENABLE ROW LEVEL SECURITY;
ALTER TABLE direction_latest  ENABLE ROW LEVEL SECURITY;
ALTER TABLE direction_history ENABLE ROW LEVEL SECURITY;   -- 서버 전용(정책 없음)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='direction_models' AND policyname='public_read') THEN
    CREATE POLICY public_read ON direction_models FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='direction_latest' AND policyname='public_read') THEN
    CREATE POLICY public_read ON direction_latest FOR SELECT USING (true);
  END IF;
END $$;
