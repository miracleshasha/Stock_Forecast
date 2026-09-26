-- ============================================================
-- 업종 · 투자자별 매매동향 (2026-09-27, 홈 2순위)
-- ============================================================

-- 업종: 미국은 S&P500 목록의 GICS Sector(한글 표기), 국내는 KIS 현재가 API 의 업종명(bstp_kor_isnm)
ALTER TABLE symbols ADD COLUMN IF NOT EXISTS sector TEXT;

-- 국내 종목 투자자별 순매수 (KIS inquire-investor, 최근 30거래일을 매일 다시 받아 덮어씀)
-- 금액 단위: 백만원 (KIS *_ntby_tr_pbmn 그대로)
CREATE TABLE IF NOT EXISTS daily_investor_flow (
  ticker          TEXT NOT NULL REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date      DATE NOT NULL,
  indiv_net_qty   BIGINT,
  foreign_net_qty BIGINT,
  inst_net_qty    BIGINT,
  indiv_net_amt   BIGINT,
  foreign_net_amt BIGINT,
  inst_net_amt    BIGINT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_investor_flow_date ON daily_investor_flow (trade_date DESC);

-- 다른 시세 테이블과 같은 규칙: 공개 읽기, 쓰기는 서비스 롤(배치)만
ALTER TABLE daily_investor_flow ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_investor_flow' AND policyname='public_read') THEN
    CREATE POLICY public_read ON daily_investor_flow FOR SELECT USING (true);
  END IF;
END $$;
