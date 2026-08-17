/** 종목 상세 로딩 스켈레톤 — 내비게이션 시 즉시 표시되어 "멈춘 느낌"을 없앰 */
export default function Loading() {
  return (
    <main className="shell shell--narrow" aria-busy="true">
      {/* 헤더 */}
      <div className="skel" style={{ width: "45%", height: 30 }} />
      <div className="skel" style={{ width: "30%", height: 14, marginTop: 10 }} />
      <div className="skel" style={{ width: "55%", height: 40, marginTop: 16 }} />

      {/* 판정 카드 */}
      <div className="verdict" style={{ marginTop: 20 }}>
        <div className="skel" style={{ width: "40%", height: 26 }} />
        <div className="skel" style={{ width: "100%", height: 62, marginTop: 16 }} />
        <div className="skel" style={{ width: "100%", height: 12, marginTop: 18 }} />
        <div className="skel" style={{ width: "85%", height: 12 }} />
      </div>

      {/* 차트 */}
      <div className="chart-wrap" style={{ marginTop: 20 }}>
        <div className="skel" style={{ width: "60%", height: 18 }} />
        <div className="skel" style={{ width: "100%", height: 320, marginTop: 12 }} />
      </div>

      <div style={{ textAlign: "center", marginTop: 22, color: "var(--dim)", fontFamily: "var(--mono)", fontSize: 13 }}>
        <span className="spinner" style={{ verticalAlign: "-3px", marginRight: 8 }} />
        판정을 불러오는 중…
      </div>
    </main>
  );
}
