-- ============================================================
-- SignalDesk — DB 스키마 (PostgreSQL / Supabase)
-- Supabase 대시보드 > SQL Editor 에 붙여넣고 실행하세요.
-- ============================================================

-- ---------- 종목 마스터 ----------
CREATE TABLE IF NOT EXISTS symbols (
  ticker        TEXT PRIMARY KEY,          -- '005930', 'AAPL'
  market        TEXT NOT NULL,             -- KOSPI | KOSDAQ | NASDAQ | NYSE
  name_ko       TEXT,
  name_en       TEXT,
  universe      TEXT[] NOT NULL DEFAULT '{}',
  currency      TEXT NOT NULL,             -- KRW | USD
  is_active     BOOLEAN DEFAULT TRUE,
  updated_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_symbols_name_ko ON symbols (lower(name_ko));
CREATE INDEX IF NOT EXISTS idx_symbols_name_en ON symbols (lower(name_en));

-- ---------- 일봉 ----------
CREATE TABLE IF NOT EXISTS daily_prices (
  ticker      TEXT REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date  DATE NOT NULL,
  open        NUMERIC(18,4),
  high        NUMERIC(18,4),
  low         NUMERIC(18,4),
  close       NUMERIC(18,4),
  volume      BIGINT,
  PRIMARY KEY (ticker, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_prices_ticker_date ON daily_prices (ticker, trade_date DESC);

-- ---------- 계산된 지표 ----------
CREATE TABLE IF NOT EXISTS daily_indicators (
  ticker        TEXT REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date    DATE NOT NULL,
  ma20 NUMERIC, ma60 NUMERIC, ma120 NUMERIC,
  bb_upper NUMERIC, bb_mid NUMERIC, bb_lower NUMERIC,
  bb_percent_b NUMERIC, bb_width NUMERIC,
  env_upper NUMERIC, env_lower NUMERIC,
  rsi14 NUMERIC,
  macd NUMERIC, macd_signal NUMERIC, macd_hist NUMERIC,
  vol_ratio20 NUMERIC, obv BIGINT,
  PRIMARY KEY (ticker, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_ind_ticker_date ON daily_indicators (ticker, trade_date DESC);

-- ---------- 매크로 (종목 무관, 날짜 단위) ----------
CREATE TABLE IF NOT EXISTS daily_macro (
  trade_date  DATE PRIMARY KEY,
  vix NUMERIC, vkospi NUMERIC,
  us10y NUMERIC, dxy NUMERIC, usdkrw NUMERIC,
  kospi_close NUMERIC, spx_close NUMERIC
);

-- ---------- 최종 판정 ----------
CREATE TABLE IF NOT EXISTS daily_signals (
  ticker        TEXT REFERENCES symbols(ticker) ON DELETE CASCADE,
  trade_date    DATE NOT NULL,
  score         SMALLINT NOT NULL,         -- -100 ~ +100
  zone          TEXT NOT NULL,             -- BUY|BUY_LEAN|NEUTRAL|SELL_LEAN|SELL|UNAVAILABLE
  summary       TEXT,
  breakdown     JSONB,                     -- {"trend":18,"momentum":12,...}
  tags          TEXT[],                    -- {"pos:정배열","neg:VIX 상승"}
  PRIMARY KEY (ticker, trade_date)
);
CREATE INDEX IF NOT EXISTS idx_signals_latest ON daily_signals (ticker, trade_date DESC);

-- ============================================================
-- 뷰: ticker별 최신 1건 (읽기 경로에서 사용)
-- ============================================================

-- 최신 시세 + 전일 대비 등락
CREATE OR REPLACE VIEW v_quote
WITH (security_invoker = true) AS
SELECT
  p.ticker,
  p.trade_date,
  p.close,
  p.close - lag(p.close) OVER w AS change,
  CASE WHEN lag(p.close) OVER w > 0
       THEN (p.close - lag(p.close) OVER w) / lag(p.close) OVER w * 100
  END AS change_pct
FROM daily_prices p
WINDOW w AS (PARTITION BY p.ticker ORDER BY p.trade_date);

CREATE OR REPLACE VIEW v_latest_quote
WITH (security_invoker = true) AS
SELECT DISTINCT ON (ticker) ticker, trade_date, close, change, change_pct
FROM v_quote
ORDER BY ticker, trade_date DESC;

CREATE OR REPLACE VIEW v_latest_signal
WITH (security_invoker = true) AS
SELECT DISTINCT ON (ticker) ticker, trade_date, score, zone
FROM daily_signals
ORDER BY ticker, trade_date DESC;

-- ============================================================
-- RLS: 서비스 롤 키는 RLS를 우회합니다.
-- anon 키로도 읽을 수 있도록 공개 SELECT 정책을 둡니다(읽기 전용 서비스).
-- ============================================================
ALTER TABLE symbols          ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_prices     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_macro      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_signals    ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='symbols' AND policyname='public_read') THEN
    CREATE POLICY public_read ON symbols FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_prices' AND policyname='public_read') THEN
    CREATE POLICY public_read ON daily_prices FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_indicators' AND policyname='public_read') THEN
    CREATE POLICY public_read ON daily_indicators FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_macro' AND policyname='public_read') THEN
    CREATE POLICY public_read ON daily_macro FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='daily_signals' AND policyname='public_read') THEN
    CREATE POLICY public_read ON daily_signals FOR SELECT USING (true);
  END IF;
END $$;
