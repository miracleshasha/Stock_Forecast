/** 종목 상세 로딩 스켈레톤 — 내비게이션 시 즉시 표시되어 "멈춘 느낌"을 없앰 */
export default function Loading() {
  return (
    <main className="shell" aria-busy="true" aria-label="종목 정보를 불러오는 중">
      <section className="card" style={{ gap: 10 }}>
        <div className="skel" style={{ width: "40%", height: 24 }} />
        <div className="skel" style={{ width: "25%" }} />
        <div className="skel" style={{ width: "55%", height: 36, marginTop: 8 }} />
        <div className="skel" style={{ width: "35%" }} />
        <div className="skel" style={{ width: "100%", height: 240, marginTop: 8 }} />
        <div className="skel" style={{ width: "100%", height: 44 }} />
      </section>
      <section className="card" style={{ gap: 10 }}>
        <div className="skel" style={{ width: "30%" }} />
        <div className="skel" style={{ width: "50%", height: 28 }} />
        <div className="skel" style={{ width: "100%", height: 10 }} />
        <div className="skel" style={{ width: "90%" }} />
        <div className="skel" style={{ width: "70%" }} />
      </section>
    </main>
  );
}
