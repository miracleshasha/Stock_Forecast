-- ============================================================
-- 지표 보관 기간 축소 (2026-10-24, 종목 확대용 DB 용량 절감)
-- daily_indicators 는 최근 keep_days 일만 둡니다. 웹 차트의 이동평균·볼린저 선은
-- daily_prices 로 직접 계산하고(web/lib/db.ts loadChart), 최신 지표·최근 봉만 이 테이블을 씁니다.
-- 지운 지표는 언제든 daily_prices 로 다시 계산할 수 있습니다(batch/indicators.py).
-- 토요일 전량 배치가 끝날 때 batch/run.py 가 호출합니다.
-- ============================================================
CREATE OR REPLACE FUNCTION prune_indicators(keep_days INTEGER DEFAULT 400) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n BIGINT;
BEGIN
  DELETE FROM daily_indicators WHERE trade_date < current_date - keep_days;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION prune_indicators(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION prune_indicators(INTEGER) TO service_role;
