-- ============================================================
-- SignalDesk — 실시간 현재가 레이어 (schema.sql 이후에 실행)
--
-- 판정 점수는 확정 일봉(daily_*) 기준을 그대로 유지하고, 화면 상단의
-- 현재가만 장중에 실시간으로 얹기 위한 테이블입니다.
-- daily_prices 는 절대 장중 값으로 건드리지 않습니다. 미완성 봉이 섞이면
-- MA·볼린저·RSI가 전부 오염되기 때문입니다.
-- ============================================================

-- ---------- 현재가 캐시 ----------
-- 웹이 종목 페이지를 열 때 KIS 현재가를 조회해 채우는 캐시.
-- TTL(기본 60초) 안이면 재조회 없이 이 행을 그대로 씁니다.
CREATE TABLE IF NOT EXISTS live_quotes (
  ticker      TEXT PRIMARY KEY REFERENCES symbols(ticker) ON DELETE CASCADE,
  price       NUMERIC(18,4),           -- 현재가
  prev_close  NUMERIC(18,4),           -- 전일 종가(등락 기준)
  change      NUMERIC(18,4),
  change_pct  NUMERIC(10,4),
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- KIS 접근토큰 공유 ----------
-- 웹은 토큰을 직접 발급하지 않습니다. KIS는 토큰 재발급에 분당 제한이 있고,
-- 서버리스는 콜드스타트마다 캐시가 날아가 발급을 반복하게 되기 때문입니다.
-- 배치가 하루 한 번 발급하며 여기에 넣어두고, 웹은 읽어 쓰기만 합니다.
CREATE TABLE IF NOT EXISTS kis_token (
  id            SMALLINT PRIMARY KEY DEFAULT 1,
  access_token  TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT kis_token_singleton CHECK (id = 1)
);

ALTER TABLE live_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE kis_token   ENABLE ROW LEVEL SECURITY;

-- live_quotes 는 공개 읽기(다른 테이블과 동일).
-- kis_token 은 정책을 두지 않습니다 → anon 키로 읽히지 않고 서비스 롤만 접근.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='live_quotes' AND policyname='public_read') THEN
    CREATE POLICY public_read ON live_quotes FOR SELECT USING (true);
  END IF;
END $$;
