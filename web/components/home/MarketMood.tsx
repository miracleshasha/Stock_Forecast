import type { Breadth } from "@/lib/home";
import { formatDateKo } from "@/lib/format";

function Delta({ n, label, tone }: { n: number; label: string; tone: "up" | "down" }) {
  if (n === 0) return null;
  return (
    <span className={tone}>
      {label} {n > 0 ? `+${n}` : n}
    </span>
  );
}

function Row({ title, b }: { title: string; b: Breadth }) {
  const total = b.up + b.neutral + b.down;
  if (total === 0) return null;
  const pct = (n: number) => `${(n / total) * 100}%`;
  const upShare = Math.round((b.up / total) * 100);
  const downShare = Math.round((b.down / total) * 100);
  const mood =
    upShare >= downShare + 15 ? "상승 흐름 종목이 더 많아요" :
    downShare >= upShare + 15 ? "하락 흐름 종목이 더 많아요" : "상승과 하락이 비슷해요";
  return (
    <div className="mood">
      <div className="mood__hd">
        <span className="mood__t">
          {title}
          {b.asOf && <span className="mood__date"> · {formatDateKo(b.asOf)}</span>}
        </span>
        <span className="mood__m">{mood}</span>
      </div>
      <div className="mood__bar" role="img" aria-label={`상승 흐름 ${b.up}, 중립 ${b.neutral}, 하락 흐름 ${b.down}`}>
        <span className="mood__seg mood__seg--up" style={{ width: pct(b.up) }} />
        <span className="mood__seg mood__seg--neu" style={{ width: pct(b.neutral) }} />
        <span className="mood__seg mood__seg--down" style={{ width: pct(b.down) }} />
      </div>
      <div className="mood__legend num">
        <span className="up">상승 {b.up}</span>
        <span>중립 {b.neutral}</span>
        <span className="down">하락 {b.down}</span>
      </div>
      {(b.upDelta !== 0 || b.downDelta !== 0) && (
        <div className="caption num" style={{ padding: 0 }}>
          직전 판정일보다 <Delta n={b.upDelta} label="상승" tone="up" />{" "}
          <Delta n={b.downDelta} label="하락" tone="down" />
        </div>
      )}
    </div>
  );
}

/** ① 오늘의 시장 분위기 — 분석 종목 중 상승/중립/하락 흐름 비율 */
export default function MarketMood({ KR, US }: { KR: Breadth; US: Breadth }) {
  return (
    <section className="card" aria-label="오늘의 시장 분위기">
      <div>
        <h2 className="sec-title">오늘의 시장 분위기</h2>
        <p className="sec-desc">분석하는 종목 중 상승·하락 흐름 종목의 비율이에요.</p>
      </div>
      <Row title="국내" b={KR} />
      <Row title="미국" b={US} />
    </section>
  );
}
