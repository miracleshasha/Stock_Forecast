import Link from "next/link";
import type { BbEvent, HomeRow } from "@/lib/home";
import type { PatternStat } from "@/lib/types";
import { MARKET_LABEL, changeTone, formatDateKo, formatPct, formatPrice } from "@/lib/format";

export interface FavAlert {
  row: HomeRow;
  events: BbEvent[];
  region: "KR" | "US";
}

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 실측 한 줄 + 근거가 있는지(평균 대비 차이가 표준오차 2배를 넘는지) */
function evidence(s: PatternStat | undefined, dir: number): { text: string; strong: boolean } | null {
  if (!s || s.se5 == null) return null;
  const sig = Math.abs(s.excess5) >= 2 * s.se5;
  const agrees = sig && Math.sign(s.excess5) === Math.sign(dir);
  const tail = !sig ? "평소와 큰 차이는 없었어요" : agrees ? "실제로도 근거가 있었어요" : "실제로는 교과서와 반대였어요";
  return {
    text: `과거 이 신호 뒤 5거래일 평균 ${pct(s.ret5)} (아무 날 ${pct(s.baseRet5)}) · ${tail}`,
    strong: agrees,
  };
}

/**
 * 관심 종목 알림 — 즐겨찾기 종목이 볼린저 밴드 상·하단을 통과한 날 홈 맨 위에 띄웁니다.
 * 하단 쪽 = 매수 고려, 상단 쪽 = 매도(차익) 고려. 실측 근거를 함께 보여줍니다.
 */
export default function FavAlerts({
  alerts,
  stats,
}: {
  alerts: FavAlert[];
  stats: { KR: Record<string, PatternStat>; US: Record<string, PatternStat> };
}) {
  if (alerts.length === 0) return null;
  return (
    <section className="card alerts" aria-label="관심 종목 알림" role="status">
      <div className="sec-hd">
        <h2 className="sec-title">관심 종목 알림</h2>
        <span className="caption" style={{ padding: 0 }}>볼린저 밴드 · 종가 기준</span>
      </div>
      <ul className="alerts__list">
        {alerts.map(({ row, events, region }) =>
          events.map((e) => {
            const buy = e.dir > 0;
            const ev = evidence(stats[region][e.key], e.dir);
            return (
              <li key={`${row.ticker}-${e.key}`}>
                <Link href={`/stock/${row.ticker}`} className="alert">
                  <span className="alert__hd">
                    <span className={`pill ${buy ? "up" : "down"}`}>{buy ? "매수 고려" : "매도 고려"}</span>
                    <span className="alert__name">{row.name}</span>
                    <span className="alert__meta">{MARKET_LABEL[row.market] ?? row.market}</span>
                  </span>
                  <span className="alert__what">
                    <b>{e.name}</b>
                    {e.date ? ` · ${formatDateKo(e.date)}` : ""} ·{" "}
                    <span className="num">{formatPrice(row.price, row.currency)}</span>{" "}
                    <span className={`num ${changeTone(row.changePct)}`}>{formatPct(row.changePct)}</span>
                  </span>
                  <span className="alert__desc">{e.desc}</span>
                  {ev && <span className={`alert__ev${ev.strong ? " alert__ev--strong" : ""}`}>{ev.text}</span>}
                </Link>
              </li>
            );
          }),
        )}
      </ul>
      <p className="caption" style={{ padding: 0 }}>
        밴드 통과는 &lsquo;살펴볼 때&rsquo;를 알려주는 신호일 뿐 매매 지시가 아니에요. 투자 판단과 결과의 책임은 본인에게 있어요.
      </p>
    </section>
  );
}
