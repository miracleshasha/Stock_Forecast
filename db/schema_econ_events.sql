-- ============================================================
-- 경제 일정 (2026-09-27, 홈 3순위)
-- 공식 출처에서 확인한 날짜만 넣습니다. 시각은 한국시간(KST).
--   FOMC   : https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
--            (결정 발표 미 동부 14:00 → 한국 다음날 03:00, 서머타임 끝나면 04:00)
--   한은   : https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755
--   CPI    : https://www.bls.gov/schedule/news_release/cpi.htm      (미 동부 08:30)
--   고용   : https://www.bls.gov/schedule/news_release/empsit.htm   (미 동부 08:30)
-- 미국 서머타임: 2026-11-01 종료, 2027-03-14 시작.
-- 매년 새 일정이 발표되면(한은은 보통 10~11월) 행을 추가해야 합니다.
-- ============================================================
CREATE TABLE IF NOT EXISTS econ_events (
  id              BIGSERIAL PRIMARY KEY,
  event_date      DATE NOT NULL,          -- 한국 날짜
  event_time_kst  TIME,                   -- 모르면 NULL (한은은 '오전'으로 표시)
  country         TEXT NOT NULL,          -- 'US' | 'KR'
  title           TEXT NOT NULL,
  category        TEXT NOT NULL,          -- '금리' | '물가' | '고용'
  importance      SMALLINT NOT NULL DEFAULT 2,  -- 3 = 시장 영향 큼
  detail          TEXT,
  source_url      TEXT,
  UNIQUE (event_date, country, title)
);
ALTER TABLE econ_events ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='econ_events' AND policyname='public_read') THEN
    CREATE POLICY public_read ON econ_events FOR SELECT USING (true);
  END IF;
END $$;

INSERT INTO econ_events (event_date, event_time_kst, country, title, category, importance, detail, source_url) VALUES
 ('2026-10-02','21:30','US','미국 고용보고서 (9월)','고용',3,'비농업 고용·실업률','https://www.bls.gov/schedule/news_release/empsit.htm'),
 ('2026-10-14','21:30','US','미국 소비자물가(CPI) 발표','물가',3,NULL,'https://www.bls.gov/schedule/news_release/cpi.htm'),
 ('2026-10-22',NULL,'KR','한국은행 기준금리 결정','금리',3,'통화정책방향 결정회의','https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755'),
 ('2026-10-29','03:00','US','FOMC 기준금리 결정','금리',3,'10월 27~28일 회의','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2026-11-06','22:30','US','미국 고용보고서 (10월)','고용',3,'비농업 고용·실업률','https://www.bls.gov/schedule/news_release/empsit.htm'),
 ('2026-11-10','22:30','US','미국 소비자물가(CPI) 발표','물가',3,NULL,'https://www.bls.gov/schedule/news_release/cpi.htm'),
 ('2026-11-26',NULL,'KR','한국은행 기준금리 결정','금리',3,'통화정책방향 결정회의','https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755'),
 ('2026-12-04','22:30','US','미국 고용보고서 (11월)','고용',3,'비농업 고용·실업률','https://www.bls.gov/schedule/news_release/empsit.htm'),
 ('2026-12-10','04:00','US','FOMC 기준금리 결정','금리',3,'12월 8~9일 회의 · 경제전망 발표','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2026-12-10','22:30','US','미국 소비자물가(CPI) 발표','물가',3,NULL,'https://www.bls.gov/schedule/news_release/cpi.htm'),
 ('2027-01-28','04:00','US','FOMC 기준금리 결정','금리',3,'1월 26~27일 회의','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-03-18','03:00','US','FOMC 기준금리 결정','금리',3,'3월 16~17일 회의 · 경제전망 발표','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-04-29','03:00','US','FOMC 기준금리 결정','금리',3,'4월 27~28일 회의','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-06-10','03:00','US','FOMC 기준금리 결정','금리',3,'6월 8~9일 회의 · 경제전망 발표','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-07-29','03:00','US','FOMC 기준금리 결정','금리',3,'7월 27~28일 회의','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-09-16','03:00','US','FOMC 기준금리 결정','금리',3,'9월 14~15일 회의 · 경제전망 발표','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-10-28','03:00','US','FOMC 기준금리 결정','금리',3,'10월 26~27일 회의','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm'),
 ('2027-12-09','04:00','US','FOMC 기준금리 결정','금리',3,'12월 7~8일 회의 · 경제전망 발표','https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
ON CONFLICT (event_date, country, title) DO NOTHING;
