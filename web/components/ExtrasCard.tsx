import type { StockExtras } from "@/lib/db";
import type { Currency, Macro } from "@/lib/types";
import { formatNum, formatPct, formatPrice } from "@/lib/format";

/** 점수에는 들어가지 않는 참고 정보: 12개월 흐름 순위 · 시장 변동성 · 52주 범위 */
export default function ExtrasCard({
  extras,
  macro,
  damp,
  currency,
}: {
  extras: StockExtras;
  macro: Macro | null;
  damp: number | null | undefined;
  currency: Currency;
}) {
  const rank = extras.mom12Rank;
  // 상위 x% — 백분위가 높을수록(강할수록) 작은 숫자
  const top = rank != null ? Math.max(1, Math.round((1 - rank) * 100)) : null;
  const momPill =
    top == null ? null : top <= 50
      ? { text: `상위 ${top}%`, cls: top <= 20 ? "up" : "" }
      : { text: `하위 ${Math.max(1, 100 - top)}%`, cls: top >= 80 ? "down" : "" };
  const regionLabel = extras.region === "KR" ? "국내" : "해외";
  const damped = damp != null && damp < 1;

  return (
    <section className="card" aria-label="함께 보면 좋은 정보">
      <h2 className="sec-title">함께 보면 좋은 정보</h2>

      <div className="info">
        <div className="info__main">
          <span className="info__k">
            12개월 흐름{extras.mom12 != null && <span className="num"> {formatPct(extras.mom12, 1)}</span>}
          </span>
          <span className="info__d">
            최근 1개월을 뺀 1년 수익률
            {extras.peers > 0 ? ` · ${regionLabel} ${extras.peers}종목과 비교` : ""}
          </span>
        </div>
        {momPill ? (
          <span className={`pill ${momPill.cls}`}>{momPill.text}</span>
        ) : (
          <span className="pill">데이터 부족</span>
        )}
      </div>

      <div className="divider" />

      <div className="info">
        <div className="info__main">
          <span className="info__k">
            시장 변동성 (VIX <span className="num">{formatNum(macro?.vix ?? null, 1)}</span>)
          </span>
          <span className="info__d">변동성이 커지면 점수를 중립 쪽으로 줄여요</span>
        </div>
        <span className="pill">{damped ? `${Math.round(damp! * 100)}%로 반영` : "그대로 반영"}</span>
      </div>

      <div className="divider" />

      <div className="kv">
        <span>52주 최고</span>
        <span className="num">{formatPrice(extras.high52, currency)}</span>
      </div>
      <div className="kv">
        <span>52주 최저</span>
        <span className="num">{formatPrice(extras.low52, currency)}</span>
      </div>
    </section>
  );
}
