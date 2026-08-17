import { scoreToPct } from "@/lib/format";

/** -100~+100 눈금자에 5색 밴드 + 황동 바늘 (S-03 시그니처 요소) */
export default function SignalGauge({ score }: { score: number }) {
  const pct = scoreToPct(score);
  return (
    <div className="gauge">
      <div className="gauge__track">
        <div className="gauge__band b1" />
        <div className="gauge__band b2" />
        <div className="gauge__band b3" />
        <div className="gauge__band b4" />
        <div className="gauge__band b5" />
      </div>
      <div className="gauge__scale">
        <span style={{ left: "0%" }}>-100</span>
        <span style={{ left: "27.3%" }}>-15</span>
        <span style={{ left: "50%" }}>0</span>
        <span style={{ left: "72.7%" }}>+15</span>
        <span style={{ left: "100%" }}>+100</span>
      </div>
      <div className="gauge__words">
        <span className="w-sell">◀ 매도</span>
        <span className="w-neu">중립</span>
        <span className="w-buy">매수 ▶</span>
      </div>
      <div className="gauge__needle" style={{ left: `${pct}%` }} />
    </div>
  );
}

/** 즐겨찾기 목록용 미니 게이지 */
export function MiniGauge({ score }: { score: number }) {
  const pct = scoreToPct(score);
  return (
    <div className="fav__mini">
      <div className="gauge__band b1" />
      <div className="gauge__band b2" />
      <div className="gauge__band b3" />
      <div className="gauge__band b4" />
      <div className="gauge__band b5" />
      <i style={{ left: `${pct}%` }} />
    </div>
  );
}
