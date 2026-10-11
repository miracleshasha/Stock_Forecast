import type { PatternStat, ShortTerm } from "@/lib/types";
import { formatDateKo } from "@/lib/format";

const MIN_DAYS = 30; // 이보다 적은 날짜에서만 나온 패턴은 실측을 말하기 어렵다고 봅니다

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

/** 실측 판정: 교과서 방향(dir)과 실제 초과수익(excess5)이 맞는지 */
function verdict(dir: number, s: PatternStat | undefined): { text: string; tone: "up" | "down" | "neu" } {
  if (!s || s.nDays < MIN_DAYS || s.se5 == null) return { text: "과거 사례가 적어 판단하기 어려워요", tone: "neu" };
  const sig = Math.abs(s.excess5) >= 2 * s.se5;
  if (!sig) return { text: "실제로는 평소와 큰 차이가 없었어요", tone: "neu" };
  const better = s.excess5 > 0;
  if (dir > 0) return better
    ? { text: "실제로도 평소보다 더 올랐어요", tone: "up" }
    : { text: "실제로는 평소보다 덜 올랐어요 (교과서와 반대)", tone: "down" };
  if (dir < 0) return better
    ? { text: "실제로는 평소보다 더 올랐어요 (교과서와 반대)", tone: "up" }
    : { text: "실제로도 평소보다 덜 올랐어요", tone: "down" };
  return better ? { text: "평소보다 더 오른 편이었어요", tone: "up" } : { text: "평소보다 덜 오른 편이었어요", tone: "down" };
}

/** 단기 신호 — 최근 1~3일 캔들 모양과 가격 위치·거래량. 판정 점수와 별개입니다. */
export default function ShortTermCard({
  shortTerm,
  stats,
  asOf,
  marketLabel,
}: {
  shortTerm: ShortTerm | null;
  stats: Record<string, PatternStat>;
  asOf: string;
  marketLabel: string;
}) {
  if (!shortTerm) return null;
  const tone = shortTerm.tone > 0 ? "up" : shortTerm.tone < 0 ? "down" : "neu";
  const anyStat = Object.values(stats)[0];
  return (
    <section className="card" aria-label="단기 신호">
      <div className="verdict__hd">
        <span className="verdict__k">단기 신호 · 캔들 패턴</span>
        {asOf && <span className="caption" style={{ padding: 0 }}>{formatDateKo(asOf)} 봉 기준</span>}
      </div>
      <span className={`verdict__zone ${tone}`} style={{ fontSize: 22 }}>{shortTerm.label}</span>

      {shortTerm.patterns.length === 0 ? (
        <p className="sec-desc">최근 1~3일 봉에서 눈에 띄는 패턴이 나오지 않았어요.</p>
      ) : (
        <ul className="patterns">
          {shortTerm.patterns.map((p) => {
            const s = stats[p.key];
            const v = verdict(p.dir, s);
            const dirTone = p.dir > 0 ? "up" : p.dir < 0 ? "down" : "";
            return (
              <li key={p.key} className="pattern">
                <div className="pattern__hd">
                  <span className={`tag ${dirTone === "up" ? "tag--pos" : dirTone === "down" ? "tag--neg" : ""}`}>{p.name}</span>
                  <span className="pattern__book">교과서상 {p.dir > 0 ? "상승" : p.dir < 0 ? "하락" : "중립"} 신호</span>
                </div>
                <p className="pattern__desc">{p.desc}</p>
                {s && (
                  <p className="pattern__stat num">
                    {marketLabel}에서 과거 {s.n.toLocaleString()}번 · 5거래일 뒤 평균 {pct(s.ret5)} (아무 날 {pct(s.baseRet5)}) · 오른 비율 {Math.round(s.win5 * 100)}%
                  </p>
                )}
                <p className={`pattern__verdict ${v.tone}`}>{v.text}</p>
              </li>
            );
          })}
        </ul>
      )}

      <p className="caption" style={{ padding: 0 }}>
        캔들 패턴은 판정 점수에 들어가지 않는 참고 정보예요.
        {anyStat?.periodFrom && anyStat?.periodTo
          ? ` 실측은 ${anyStat.periodFrom.slice(0, 4)}년~${anyStat.periodTo.slice(0, 4)}년 우리 분석 종목 일봉 기준이에요.`
          : ""}{" "}
        우리 데이터에서는 대부분의 패턴이 평소와 큰 차이를 보이지 않았어요.
      </p>
    </section>
  );
}
