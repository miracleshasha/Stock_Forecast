-- ============================================================
-- 홈 화면용 종목별 요약 (2026-09-27)
-- 52주 고저·거래량 배수·12-1 모멘텀·최신/직전 판정을 종목당 한 줄로 미리 계산합니다.
-- 요청마다 계산하면 수 초가 걸려서(670종목 × 1년치) 머티리얼라이즈드 뷰로 두고,
-- 배치가 적재를 마친 뒤 refresh_home_stats() 로 갱신합니다.
--
-- 머티리얼라이즈드 뷰는 RLS 가 없으므로 anon/authenticated 에서 권한을 빼고
-- 서비스 롤(웹 서버·배치)만 읽게 합니다.
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_home_stats AS
SELECT
  s.ticker,
  s.market,
  p.trade_date,
  p.close,
  p.high,
  p.low,
  prev.close        AS prev_close,
  w.hi52,           -- 오늘 제외, 직전 1년 최고가
  w.lo52,           -- 오늘 제외, 직전 1년 최저가
  i.vol_ratio20,
  m1.close          AS close_21,    -- 21거래일 전 종가 (12-1 모멘텀의 '최근 1개월 제외' 기준점)
  m12.close         AS close_252,   -- 252거래일 전 종가
  sig.score,
  sig.zone,
  sig.trade_date    AS signal_date,
  sig_prev.zone     AS zone_prev
FROM symbols s
CROSS JOIN LATERAL (
  SELECT trade_date, close, high, low FROM daily_prices d
  WHERE d.ticker = s.ticker ORDER BY trade_date DESC LIMIT 1
) p
LEFT JOIN LATERAL (
  SELECT close FROM daily_prices d
  WHERE d.ticker = s.ticker ORDER BY trade_date DESC OFFSET 1 LIMIT 1
) prev ON true
LEFT JOIN LATERAL (
  SELECT max(high) AS hi52, min(low) AS lo52 FROM daily_prices d
  WHERE d.ticker = s.ticker AND d.trade_date > p.trade_date - 365 AND d.trade_date < p.trade_date
) w ON true
LEFT JOIN LATERAL (
  SELECT vol_ratio20 FROM daily_indicators x
  WHERE x.ticker = s.ticker ORDER BY trade_date DESC LIMIT 1
) i ON true
LEFT JOIN LATERAL (
  SELECT close FROM daily_prices d
  WHERE d.ticker = s.ticker ORDER BY trade_date DESC OFFSET 21 LIMIT 1
) m1 ON true
LEFT JOIN LATERAL (
  SELECT close FROM daily_prices d
  WHERE d.ticker = s.ticker ORDER BY trade_date DESC OFFSET 252 LIMIT 1
) m12 ON true
LEFT JOIN LATERAL (
  SELECT score, zone, trade_date FROM daily_signals g
  WHERE g.ticker = s.ticker ORDER BY trade_date DESC LIMIT 1
) sig ON true
LEFT JOIN LATERAL (
  SELECT zone FROM daily_signals g
  WHERE g.ticker = s.ticker ORDER BY trade_date DESC OFFSET 1 LIMIT 1
) sig_prev ON true
WHERE s.is_active;

-- CONCURRENTLY 갱신(읽는 중에도 막히지 않음)에 고유 인덱스가 필요합니다
CREATE UNIQUE INDEX IF NOT EXISTS mv_home_stats_ticker ON mv_home_stats (ticker);

REVOKE ALL ON mv_home_stats FROM anon, authenticated;
GRANT SELECT ON mv_home_stats TO service_role;

CREATE OR REPLACE FUNCTION refresh_home_stats() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_home_stats;
$$;
REVOKE ALL ON FUNCTION refresh_home_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION refresh_home_stats() TO service_role;
