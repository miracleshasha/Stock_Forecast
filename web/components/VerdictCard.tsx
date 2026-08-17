import type { Signal } from "@/lib/types";
import { ZONE_LABEL, zoneTone } from "@/lib/format";
import SignalGauge from "./SignalGauge";

const DISCLAIMER =
  "본 정보는 기술적 지표 기반 참고 자료이며 투자 권유가 아닙니다. 투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.";

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
      <div className="verdict verdict--neu">
        <div className="verdict__hd">
          <span className="plate">종합 판정</span>
          <span className="verdict__zone neu">판정 불가</span>
        </div>
        <div className="verdict__sum">
          데이터 부족(상장 1년 미만), 거래정지, 또는 지표 결측으로 이 종목은 판정을
          제공하지 않습니다. 억지 판정 대신 판정을 보류합니다.
        </div>
        <div className="disc">{DISCLAIMER}</div>
      </div>
    );
  }

  const tone = zoneTone(signal.zone);
  const modifier = tone === "up" ? "" : tone === "down" ? " verdict--down" : " verdict--neu";

  return (
    <div className={`verdict${modifier}`}>
      <div className="verdict__hd">
        <span className="plate">종합 판정</span>
        <span className={`verdict__zone ${tone}`}>{ZONE_LABEL[signal.zone]}</span>
        <span className="verdict__score">
          SCORE <b>{signal.score > 0 ? `+${signal.score}` : signal.score}</b> / 100
        </span>
      </div>
      <SignalGauge score={signal.score} />
      {signal.summary && <div className="verdict__sum">{signal.summary}</div>}
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
      <div className="disc">{DISCLAIMER}</div>
    </div>
  );
}
