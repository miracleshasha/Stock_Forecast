-- ============================================================
-- DB 용량 주간 추적 (2026-10-26) — batch/db_usage.py
--   무료 플랜 500MB 한도에 언제 닿는지는 한 번 재서는 알 수 없고 시계열이 필요합니다.
--   토요일 전량 배치가 끝날 때 record_db_usage() 로 그날 용량을 한 줄 남기고,
--   batch/db_usage.py 가 쌓인 기록으로 주당 증가량과 도달 예상 시점을 계산합니다.
--
--   용량 자체는 1KB 남짓이라(주당 1행) 추적이 한도를 잡아먹지 않습니다.
-- ============================================================
CREATE TABLE IF NOT EXISTS db_usage (
  measured_on  DATE PRIMARY KEY,           -- 측정일(하루 한 행, 재실행하면 덮어씀)
  total_bytes  BIGINT NOT NULL,            -- public 스키마 테이블+인덱스 합계 (한도 비교 기준)
  table_bytes  BIGINT NOT NULL,            -- 본문만
  index_bytes  BIGINT NOT NULL,            -- 인덱스만 (중복 인덱스가 생기면 여기서 먼저 티어납니다)
  db_bytes     BIGINT NOT NULL,            -- pg_database_size (시스템 카탈로그 포함)
  by_table     JSONB  NOT NULL,            -- {테이블명: 전체바이트} — 어디가 늘었는지 추적용
  symbols      INTEGER,                    -- 그 시점 활성 종목 수 (종목당 용량 환산용)
  measured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT db_usage_bytes_nonneg CHECK (total_bytes >= 0 AND db_bytes >= 0)
);

-- 서버(배치·service key) 전용: 정책을 두지 않아 anon/authenticated 는 읽을 수 없습니다
ALTER TABLE db_usage ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 현재 용량을 재서 db_usage 에 기록합니다. 기록한 값을 JSON 으로 돌려줍니다.
-- pg_class 는 service_role 로도 바로 읽을 수 있지만, PostgREST 로는 임의 SQL 을 보낼 수
-- 없어 함수로 감쌉니다(refresh_home_stats · prune_indicators 와 같은 방식).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_db_usage() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_table BIGINT;
  v_index BIGINT;
  v_by    JSONB;
  v_syms  INTEGER;
  v_db    BIGINT;
BEGIN
  -- relkind 'r'(테이블) + 'm'(머티리얼라이즈드 뷰). 인덱스·토스트는 각 소유 테이블에 포함됩니다.
  SELECT coalesce(sum(pg_table_size(c.oid)), 0),
         coalesce(sum(pg_indexes_size(c.oid)), 0),
         coalesce(jsonb_object_agg(c.relname, pg_total_relation_size(c.oid)), '{}'::jsonb)
    INTO v_table, v_index, v_by
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'm');

  SELECT count(*) INTO v_syms FROM symbols WHERE is_active;
  v_db := pg_database_size(current_database());

  INSERT INTO db_usage (measured_on, total_bytes, table_bytes, index_bytes,
                        db_bytes, by_table, symbols, measured_at)
  VALUES (current_date, v_table + v_index, v_table, v_index,
          v_db, v_by, v_syms, now())
  ON CONFLICT (measured_on) DO UPDATE SET
    total_bytes = excluded.total_bytes,
    table_bytes = excluded.table_bytes,
    index_bytes = excluded.index_bytes,
    db_bytes    = excluded.db_bytes,
    by_table    = excluded.by_table,
    symbols     = excluded.symbols,
    measured_at = excluded.measured_at;

  RETURN jsonb_build_object(
    'measured_on', current_date,
    'total_bytes', v_table + v_index,
    'table_bytes', v_table,
    'index_bytes', v_index,
    'db_bytes',    v_db,
    'symbols',     v_syms
  );
END $$;
REVOKE ALL ON FUNCTION record_db_usage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_db_usage() TO service_role;
