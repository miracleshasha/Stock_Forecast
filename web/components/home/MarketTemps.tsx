import type { Temp } from "@/lib/home";
import { formatDateKo } from "@/lib/format";

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  if (values.length < 2) return null;
  const w = 72, h = 28, pad = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${((i / (values.length - 1)) * (w - pad * 2) + pad).toFixed(1)},${(h - pad - ((v - min) / span) * (h - pad * 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg className={`spark ${tone}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function fmtValue(t: Temp): string {
  if (t.kind === "rate") return `${t.value.toFixed(2)}%`;
  if (t.kind === "spread") return `${t.value > 0 ? "+" : ""}${t.value.toFixed(2)}%p`;
  if (t.kind === "usd") return `$${t.value.toFixed(2)}`;
  if (t.kind === "vix") return t.value.toFixed(1);
  if (t.kind === "fx") return `${t.value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })}원`;
  return t.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtChange(t: Temp): string {
  const sign = t.change > 0 ? "+" : t.change < 0 ? "−" : "";
  const a = Math.abs(t.change);
  if (t.kind === "rate" || t.kind === "spread") return `${sign}${(a * 100).toFixed(0)}bp`;
  if (t.kind === "index" || t.kind === "usd") return `${sign}${Math.abs((t.change / (t.value - t.change)) * 100).toFixed(2)}%`;
  if (t.kind === "fx") return `${sign}${a.toFixed(1)}원`;
  return `${sign}${a.toFixed(1)}`;
}

/** ③ 시장 온도계 — 지수·변동성·금리·환율. 지표마다 발표 시점이 달라 각자 기준일을 붙입니다. */
export default function MarketTemps({ temps }: { temps: Temp[] }) {
  if (temps.length === 0) return null;
  return (
    <section className="card" aria-label="시장 온도계">
      <h2 className="sec-title">시장 온도계</h2>
      <div className="temps">
        {temps.map((t) => {
          const tone = t.change === 0 ? "neu" : t.change > 0 ? "up" : "down";
          return (
            <div className="temp" key={t.key}>
              <div className="temp__main">
                <span className="temp__k">{t.label}</span>
                <span className="temp__v num">
                  {fmtValue(t)} <span className={`temp__c ${tone}`}>{fmtChange(t)}</span>
                </span>
                <span className="temp__d">
                  {formatDateKo(t.date)} 기준{t.note ? ` · ${t.note}` : ""}
                </span>
              </div>
              <Sparkline values={t.spark} tone={tone} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
