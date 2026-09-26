import type { Signal } from "@/lib/types";
import { ZONE_LABEL, ZONE_PLAIN, formatDateKo, formatScore, zoneTone } from "@/lib/format";
import SignalGauge from "./SignalGauge";

/** 태그 인코딩: "pos:정배열" / "neg:VIX 상승" / "neu:..." */
function parseTag(raw: string): { label: string; cls: string } {
  const m = /^(pos|neg|neu):(.*)$/.exec(raw);
  if (!m) return { label: raw, cls: "" };
  const cls = m[1] === "pos" ? "tag--pos" : m[1] === "neg" ? "tag--neg" : "";
  return { label: m[2], cls };
}

export default function VerdictCard({ signal }: { signal: Signal | null }) {
  if (!signal || signal.zone === "UNAVAILABLE") {
    return (
      <section className="card" aria-label="지금 차트 흐름">
        <div className="verdict__hd">
          <span className="verdict__k">지금 차트 흐름</span>
        </div>
        <span className="verdict__zone neu">판정 보류</span>
        <p className="verdict__sum">
          데이터가 부족하거나(상장 1년 미만), 거래정지 또는 지표 결측으로 이 종목은 판정하지
          않아요.
        </p>
      </section>
    );
  }

  const tone = zoneTone(signal.zone);
  const damp = signal.breakdown.damp;

  return (
    <section className="card" aria-label="지금 차트 흐름">
      <div className="verdict__hd">
        <span className="verdict__k">지금 차트 흐름</span>
        {signal.asOf && <span className="caption">{formatDateKo(signal.asOf)} 기준</span>}
      </div>

      <div className="verdict__main">
        <span className={`verdict__zone ${tone}`}>{ZONE_LABEL[signal.zone]}</span>
        <span className="verdict__score num">{formatScore(signal.score)}점</span>
      </div>

      <SignalGauge score={signal.score} />

      <p className="verdict__sum">{signal.summary || ZONE_PLAIN[signal.zone]}</p>

      {signal.tags.length > 0 && (
        <div className="tags">
          {signal.tags.map((t, i) => {
            const { label, cls } = parseTag(t);
            return (
              <span key={i} className={`tag ${cls}`}>
                {label}
              </span>
            );
          })}
        </div>
      )}

      {damp != null && damp < 1 && (
        <p className="verdict__damp">
          시장 변동성이 커서 점수를 중립 쪽으로 {Math.round((1 - damp) * 100)}% 줄였어요.
        </p>
      )}
    </section>
  );
}
