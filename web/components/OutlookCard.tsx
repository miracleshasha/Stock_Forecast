import type { Currency, Outlook, OutlookHorizon } from "@/lib/types";
import { formatDateKo, formatPrice } from "@/lib/format";

// 방향 모델 근거(피처) → 화면 문구. 피처는 같은 날 같은 시장 종목 중 순위로 들어갑니다.
const DRIVER_LABEL: Record<string, string> = {
  r1: "하루 수익률",
  r5: "1주 수익률",
  r10: "2주 수익률",
  r20: "1개월 수익률",
  r60: "3개월 수익률",
  mom12_1: "12개월 모멘텀",
  ma20_gap: "20일선 대비 위치",
  ma60_gap: "60일선 대비 위치",
  ma120_gap: "120일선 대비 위치",
  rsi14: "RSI",
  bb_pctb: "볼린저 밴드 안 위치",
  vol20: "최근 1개월 변동성",
  vol60: "최근 3개월 변동성",
  hi52_gap: "52주 고점 근접도",
  lo52_gap: "52주 저점 대비 상승폭",
  log_vol_ratio: "거래량",
  ex20: "지수 대비 1개월 성과",
  ex60: "지수 대비 3개월 성과",
};

const pctTxt = (v: number | null, digits = 1) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

/** 0을 가운데 둔 범위 막대. scale = 세 기간 공통 최대 절댓값(기간끼리 폭을 비교할 수 있게) */
function RangeBar({ lo, mid, hi, scale }: { lo: number; mid: number | null; hi: number; scale: number }) {
  const x = (v: number) => 50 + (Math.max(-scale, Math.min(scale, v)) / scale) * 50;
  const negL = x(lo);
  const negR = x(Math.min(0, hi));
  const posL = x(Math.max(0, lo));
  const posR = x(hi);
  return (
    <div className="outlook__bar" aria-hidden>
      <span className="outlook__zero" />
      {lo < 0 && <span className="outlook__seg outlook__seg--down" style={{ left: `${negL}%`, width: `${negR - negL}%` }} />}
      {hi > 0 && <span className="outlook__seg outlook__seg--up" style={{ left: `${posL}%`, width: `${posR - posL}%` }} />}
      {mid != null && <span className="outlook__mid" style={{ left: `${x(mid)}%` }} />}
    </div>
  );
}

/** 기간 한 줄. 사용법 안내에서도 같은 모양을 보여 주려고 내보냅니다 */
export function OutlookRow({
  o,
  scale,
  close,
  currency,
}: {
  o: OutlookHorizon;
  scale: number;
  close: number | null;
  currency: Currency;
}) {
  const diff = o.p - o.base;
  const tone = o.enabled && Math.abs(diff) >= 0.02 ? (diff > 0 ? "up" : "down") : "";
  return (
    <li className="outlook__row">
      <div className="outlook__top">
        <span className="outlook__h">{o.h}거래일 뒤</span>
        <span className="outlook__p">
          오를 확률 <b className={`num ${tone}`}>{Math.round(o.p * 100)}%</b>
          {o.enabled && <span className="outlook__base num"> (평소 {Math.round(o.base * 100)}%)</span>}
        </span>
      </div>
      {o.lo != null && o.hi != null && (
        <>
          <RangeBar lo={o.lo} mid={o.mid} hi={o.hi} scale={scale} />
          <div className="outlook__range num">
            <span className="down">{pctTxt(o.lo)}</span>
            <span className="outlook__dots">~</span>
            <span className="up">{pctTxt(o.hi)}</span>
            {close != null && (
              <span className="outlook__px">
                {formatPrice(close * (1 + o.lo), currency)} ~ {formatPrice(close * (1 + o.hi), currency)}
              </span>
            )}
          </div>
        </>
      )}
      {o.enabled && o.drivers.length > 0 && (
        <p className="outlook__why">
          {o.drivers
            .map(([f, c, lvl]) => `${DRIVER_LABEL[f] ?? f} ${lvl > 0 ? "높은 편" : "낮은 편"}(${c > 0 ? "↑" : "↓"})`)
            .join(" · ")}
        </p>
      )}
    </li>
  );
}

/** N일 뒤 전망 — 오를 확률과 80% 확률로 들어올 수익률 범위. */
export default function OutlookCard({
  outlook,
  close,
  closeAsOf,
  currency,
  marketLabel,
}: {
  outlook: Outlook | null;
  close: number | null;
  closeAsOf: string | null;
  currency: Currency;
  marketLabel: string;
}) {
  if (!outlook) return null;
  const hs = outlook.horizons;
  const scale = Math.max(0.01, ...hs.flatMap((o) => [Math.abs(o.lo ?? 0), Math.abs(o.hi ?? 0)]));
  // 가격 환산은 전망 기준일 종가와 화면 종가가 같을 때만(장중 실시간 값과 섞지 않음)
  const px = close != null && closeAsOf === outlook.asOf ? close : null;
  const anyOn = hs.some((o) => o.enabled);
  const rw = hs.find((o) => o.rangeWf)?.rangeWf;
  const wf = hs.find((o) => o.wf)?.wf;
  const baseTxt = hs.map((o) => `${o.h}일 ${Math.round(o.base * 100)}%`).join(" · ");

  return (
    <section className="card" aria-label="N일 뒤 전망">
      <div className="verdict__hd">
        <span className="verdict__k">N일 뒤 전망</span>
        <span className="caption" style={{ padding: 0 }}>{formatDateKo(outlook.asOf)} 종가 기준</span>
      </div>

      <ul className="outlook">
        {hs.map((o) => (
          <OutlookRow key={o.h} o={o} scale={scale} close={px} currency={currency} />
        ))}
      </ul>

      <p className="sec-desc outlook__note">
        {anyOn ? (
          <>확률은 같은 날 {marketLabel} 사이에서 이 종목의 차트 위치·모멘텀·변동성을 비교해 낸 값이에요. 괄호 안은 평소 오른 비율이에요.</>
        ) : (
          <>
            <b>오를지 내릴지</b>는 이 종목만의 근거로 시장 평균과 다르게 말하기 어려워요. 차트·모멘텀·변동성
            지표 18가지로 검증했지만 종목별 방향을 평균보다 잘 맞히지 못해서, 확률은 {marketLabel}이 그 기간
            뒤에 오른 평균 비율({baseTxt})을 보여드려요.
          </>
        )}{" "}
        <b>움직일 범위</b>는 잘 맞는 편이에요. 막대는 80% 확률로 들어올 구간이고, 가운데 점은 중간값이에요.
      </p>

      <p className="caption" style={{ padding: 0 }}>
        {rw && wf?.from && wf?.to
          ? `${wf.from.slice(0, 7).replace("-", ".")}~${wf.to.slice(0, 7).replace("-", ".")} 검증에서 80% 구간에 실제로 ${Math.round(rw.coverage * 100)}%가 들어왔어요. `
          : ""}
        매주 토요일 다시 검증하고, 방향 예측이 검증을 통과하면 자동으로 반영돼요. 참고용이에요.
      </p>
    </section>
  );
}
