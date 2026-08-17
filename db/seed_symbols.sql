-- ============================================================
-- SignalDesk — 시작 유니버스 (소규모 ~40종목)
-- schema.sql 실행 후 이 파일을 실행하세요.
-- 배치는 이 symbols 테이블을 읽어 대상 종목을 결정합니다.
-- ============================================================

INSERT INTO symbols (ticker, market, name_ko, name_en, universe, currency) VALUES
-- KOSPI
('005930','KOSPI','삼성전자','Samsung Electronics','{KOSPI200}','KRW'),
('000660','KOSPI','SK하이닉스','SK hynix','{KOSPI200}','KRW'),
('373220','KOSPI','LG에너지솔루션','LG Energy Solution','{KOSPI200}','KRW'),
('207940','KOSPI','삼성바이오로직스','Samsung Biologics','{KOSPI200}','KRW'),
('005380','KOSPI','현대차','Hyundai Motor','{KOSPI200}','KRW'),
('000270','KOSPI','기아','Kia','{KOSPI200}','KRW'),
('068270','KOSPI','셀트리온','Celltrion','{KOSPI200}','KRW'),
('035420','KOSPI','NAVER','NAVER','{KOSPI200}','KRW'),
('035720','KOSPI','카카오','Kakao','{KOSPI200}','KRW'),
('105560','KOSPI','KB금융','KB Financial','{KOSPI200}','KRW'),
('055550','KOSPI','신한지주','Shinhan Financial','{KOSPI200}','KRW'),
('005490','KOSPI','POSCO홀딩스','POSCO Holdings','{KOSPI200}','KRW'),
('012330','KOSPI','현대모비스','Hyundai Mobis','{KOSPI200}','KRW'),
('051910','KOSPI','LG화학','LG Chem','{KOSPI200}','KRW'),
('006400','KOSPI','삼성SDI','Samsung SDI','{KOSPI200}','KRW'),
('028260','KOSPI','삼성물산','Samsung C&T','{KOSPI200}','KRW'),
('015760','KOSPI','한국전력','KEPCO','{KOSPI200}','KRW'),
('032830','KOSPI','삼성생명','Samsung Life','{KOSPI200}','KRW'),
('003670','KOSPI','포스코퓨처엠','POSCO Future M','{KOSPI200}','KRW'),
('066570','KOSPI','LG전자','LG Electronics','{KOSPI200}','KRW'),
-- KOSDAQ
('247540','KOSDAQ','에코프로비엠','Ecopro BM','{KOSDAQ150}','KRW'),
('086520','KOSDAQ','에코프로','Ecopro','{KOSDAQ150}','KRW'),
('196170','KOSDAQ','알테오젠','Alteogen','{KOSDAQ150}','KRW'),
('068760','KOSDAQ','셀트리온제약','Celltrion Pharm','{KOSDAQ150}','KRW'),
('293490','KOSDAQ','카카오게임즈','Kakao Games','{KOSDAQ150}','KRW'),
('041510','KOSDAQ','에스엠','SM Entertainment','{KOSDAQ150}','KRW'),
('035900','KOSDAQ','JYP Ent.','JYP Entertainment','{KOSDAQ150}','KRW'),
('022100','KOSDAQ','포스코DX','POSCO DX','{KOSDAQ150}','KRW'),
('357780','KOSDAQ','솔브레인','Soulbrain','{KOSDAQ150}','KRW'),
-- US (NASDAQ100 / S&P500)
('AAPL','NASDAQ',NULL,'Apple','{NASDAQ100,SP500}','USD'),
('MSFT','NASDAQ',NULL,'Microsoft','{NASDAQ100,SP500}','USD'),
('NVDA','NASDAQ',NULL,'NVIDIA','{NASDAQ100,SP500}','USD'),
('AMZN','NASDAQ',NULL,'Amazon','{NASDAQ100,SP500}','USD'),
('GOOGL','NASDAQ',NULL,'Alphabet','{NASDAQ100,SP500}','USD'),
('META','NASDAQ',NULL,'Meta Platforms','{NASDAQ100,SP500}','USD'),
('TSLA','NASDAQ',NULL,'Tesla','{NASDAQ100,SP500}','USD'),
('AVGO','NASDAQ',NULL,'Broadcom','{NASDAQ100,SP500}','USD'),
('AMD','NASDAQ',NULL,'AMD','{NASDAQ100,SP500}','USD'),
('NFLX','NASDAQ',NULL,'Netflix','{NASDAQ100,SP500}','USD')
ON CONFLICT (ticker) DO UPDATE
  SET market = EXCLUDED.market,
      name_ko = EXCLUDED.name_ko,
      name_en = EXCLUDED.name_en,
      universe = EXCLUDED.universe,
      currency = EXCLUDED.currency,
      updated_at = now();
