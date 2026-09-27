import type { Temp } from "@/lib/home";
import { formatDateKo } from "@/lib/format";

function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 120, h = 36, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (i / (values.length - 1)) * (w - pad * 2) + pad,
    h - pad - ((v - min) / span) * (h - pad * 2),
  ]);
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `M${pts[0][0].toFixed(1)},${h} L${line.replace(/ /g, " L")} L${pts[pts.length - 1][0].toFixed(1)},${h} Z`;
  return (
    <svg className="brief__spark" width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <path d={area} fill="currentColor" opacity="0.18" />
      <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 뉴스 화면 상단 — 국내·미국 대표 지수의 최근 마감 등락 */
export default function MarketBrief({ temps }: { temps: Temp[] }) {
  const picks = temps.filter((t) => t.kind === "index");
  if (picks.length === 0) return null;
  return (
    <section className="brief" aria-label="마감 시황">
      <span className="brief__k">마감 시황</span>
      <div className="brief__grid">
        {picks.map((t) => {
          const prev = t.value - t.change;
          const pct = prev ? (t.change / prev) * 100 : 0;
          const tone = t.change > 0 ? "up" : t.change < 0 ? "down" : "neu";
          return (
            <div className={`brief__item brief__item--${tone}`} key={t.key}>
              <span className="brief__name">{t.label}</span>
              <span className="brief__v num">
                {t.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="brief__c num">
                {tone === "up" ? "▲" : tone === "down" ? "▼" : "–"} {Math.abs(pct).toFixed(2)}%
              </span>
              <Spark values={t.spark} />
              <span className="brief__d">{formatDateKo(t.date)} 기준</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
