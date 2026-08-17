# SignalDesk (시그널데스크)

종목 하나를 검색하면 **"지금 이 종목은 매수 구간인가 매도 구간인가"** 를 기술적 지표 +
매크로 지표를 합산한 단일 점수(-100~+100)로 보여주는 개인용 웹서비스.

- 1차 MVP: 로그인·결제 없이 검색 → 판정. 즐겨찾기는 브라우저(localStorage) 저장.
- 데이터 소스: **한국투자증권 KIS API** · 저장소: **Supabase(PostgreSQL)** · 갱신: 일 1회 배치
- 색상 규약: **상승 = 레드 / 하락 = 블루** (국내 관례)

```
Stock_prediction/
├─ web/     Next.js 16 (App Router, TS) — 읽기 경로. Supabase에서 SELECT만.
├─ batch/   Python — 쓰기 경로. KIS 수집 → 지표 계산 → 스코어링 → Supabase 업서트.
├─ db/      schema.sql · seed_symbols.sql
└─ 시그널데스크_기획서.md · 시그널데스크_스토리보드.html
```

핵심 아키텍처는 **읽기/쓰기 분리**입니다. 사용자가 검색할 때 계산하지 않고, 매일 배치가
채워둔 테이블에서 행 하나를 읽습니다. (기획서 §7.2)

---

## 준비 (한 번만)

### 1. Supabase 프로젝트 + 스키마
1. [supabase.com](https://supabase.com) 에서 프로젝트 생성.
2. **SQL Editor** 에서 `db/schema.sql` 전체를 붙여넣고 실행.
3. 이어서 `db/seed_symbols.sql` 실행 (시작 유니버스 ~39종목 적재).
4. **Project Settings → API** 에서 아래 값을 확인:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` (서버/배치 전용, 노출 금지)

### 2. KIS API 키
1. [한국투자증권 API 포털](https://apiportal.koreainvestment.com) 에서 앱 등록.
2. `APP KEY` / `APP SECRET` 발급 → 배치 `.env` 에 입력.
3. 해외주식 시세를 쓰려면 해외 시세 이용 신청이 필요할 수 있습니다. **확인이 필요합니다.**

---

## 배치 실행 (쓰기 경로)

```bash
cd batch
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env      # 값 채우기 (KIS 키 + Supabase)
.venv/bin/python run.py            # 전체 종목
.venv/bin/python run.py 005930 AAPL  # 특정 종목만
```

- `daily_prices` / `daily_indicators` / `daily_signals` / `daily_macro` 가 채워집니다.
- 종목 단위로 재시도하며, 한 종목 실패가 전체를 막지 않습니다.
- 3Y 차트까지 채우려면 `.env` 의 `LOOKBACK_TRADING_DAYS` 를 800 이상으로 (호출 증가).

### 매일 자동 실행 (launchd, 설치됨)
평일 18:30 KST 자동 실행되도록 macOS LaunchAgent가 설치되어 있습니다.
- 정의: `batch/com.signaldesk.batch.plist` → `~/Library/LaunchAgents/` 에 복사됨
- 래퍼: `batch/run_daily.sh` (로그: `batch/logs/batch-YYYYMMDD.log`, 30일 후 자동 삭제)

```bash
launchctl list | grep signaldesk                         # 등록 확인
launchctl kickstart gui/$(id -u)/com.signaldesk.batch    # 지금 즉시 실행
launchctl bootout   gui/$(id -u)/com.signaldesk.batch    # 해제(중단)
```
> Mac이 켜져 있어야 실행됩니다. 24/7 실행이 필요하면 GitHub Actions cron으로 이전 가능.

### 유니버스 확장
```bash
.venv/bin/python universe.py    # S&P500(CSV) + KR 대형주를 symbols에 적재
.venv/bin/python run.py         # 전체 배치(해외 거래소 NAS/NYS/AMS 자동 보정)
.venv/bin/python run.py --prune # 시세가 없는(무효/상폐) 종목 정리
```
- US S&P500은 datahub 공개 CSV에서 소싱(거래소는 배치가 자동 판별).
- KOSPI200/KOSDAQ150 정확한 구성종목은 이 환경에서 KRX/pykrx가 응답하지 않아
  대형주 큐레이션(`batch/universe.py` 의 `KR_EXTRA`)으로 대체했습니다. **확인이 필요합니다.**

---

## 웹 실행 (읽기 경로)

```bash
cd web
npm install
cp .env.local.example .env.local   # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
npm run dev                        # http://localhost:3000
```

- 홈: 검색(자동완성) + 시장 요약(VIX/VKOSPI)
- `/stock/:ticker`: 종목명 → 현재가 → **종합 판정 카드(시그널 게이지)** → 차트 → 지표 근거
- `/favorites`: 즐겨찾기 (localStorage, 최대 20)

Supabase 미연결 시에는 각 화면에 설정 안내가 표시됩니다(배치·env 확인).

---

## 스코어링 (기획서 §5.1)

| 그룹 | 가중치 | 지표 |
|---|---|---|
| 추세 | **34%** | MA 배열(20/60/120), 종가 vs MA20 |
| 모멘텀 | **17%** | RSI(14), MACD |
| 밴드 위치 | **17%** | 볼린저 %B, 밴드폭(스퀴즈), 엔벨로프 |
| 거래량 | **17%** | 거래량/20일평균, OBV 추세 |
| 매크로 | 15% | VIX(국내는 VKOSPI 우선), 미10년물·USD/KRW 추세, 지수 대비 상대강도(RS) |

각 지표를 -2~+2로 점수화 → 그룹 가중합 → -100~+100 정규화 → 5단계 구간 판정.

**가중치 보정**: `batch/backtest.py` 가 적재된 일봉으로 각 시점 점수를 재현하고
H거래일 뒤 수익률과의 순위상관(IC)으로 예측력을 측정, 그리드 탐색으로 가중치를 제안합니다.
현재 값(34/17/17/17/15)은 2026-08 데이터 1차 보정 결과입니다.
```bash
.venv/bin/python backtest.py        # IC + 5분위 + 가중치 제안
.venv/bin/python test_synthetic.py  # 합성 데이터 파이프라인 검증
```

> ⚠️ 현재 보정은 **상승장 표본의 in-sample** 결과라 추세 비중이 높습니다.
> 더 긴 기간·out-of-sample 재검증이 필요합니다. 원안 25/25/20/15/15 로 되돌리려면
> `batch/scoring.py` 의 `WEIGHTS` 와 `web/components/IndicatorPanel.tsx` 의 `GROUP_WEIGHT` 를 함께 수정.

---

## 아직 확인이 필요한 항목 (기획서 §13)

- **매크로**: VIX·미10년물·USD/KRW·S&P500·달러지수는 **FRED 공개 CSV**로 연동됨(키 불필요,
  `batch/fred.py`). **VKOSPI만** 무료 소스가 없어 미연결 → 국내 종목은 VIX로 대체. KOSPI 지수는 KIS.
- **KIS 해외 시세 이용 조건 / 호출 한도** — 확인 필요(대규모 유니버스 배치 시 유량제한 주의).
- **KOSPI200/KOSDAQ150 정확한 구성종목** — KRX/pykrx 미응답으로 대형주 큐레이션 대체(확인 필요).
- **스코어링 가중치** — `backtest.py` 1차 보정 완료(in-sample). out-of-sample 재검증 필요.
- **2차(유료화) 시 유사투자자문업 신고 / 시세 재배포 라이선스** — 반드시 전문가 확인.

---

## 다음 단계 (기획서 2·3차)

로그인/즐겨찾기 서버 이관, 일일 조회 한도·페이월, 결제, 알림, 스크리너 등.
1차 구조(읽기/쓰기 분리, Supabase Auth 준비)가 2차 확장을 그대로 받습니다.
