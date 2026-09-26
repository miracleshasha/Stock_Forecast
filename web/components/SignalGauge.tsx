import { scoreToPct } from "@/lib/format";

/** -100(하락 흐름) ~ +100(상승 흐름) 막대 위에 현재 점수 위치 */
export default function SignalGauge({ score }: { score: number }) {
  const pct = scoreToPct(score);
  return (
    <div className="gauge">
      <div
        className="gauge__track"
        role="meter"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-label="차트 흐름 점수"
      >
        <span className="gauge__knob" style={{ left: `${pct}%` }} />
      </div>
      <div className="gauge__labels num">
        <span>하락 흐름 −100</span>
        <span>중립</span>
        <span>상승 흐름 +100</span>
      </div>
    </div>
  );
}
