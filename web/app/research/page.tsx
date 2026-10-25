import "server-only";
import Link from "next/link";
import { getRankEvaluationReport } from "@/lib/model-research";

export const dynamic = "force-dynamic";
export const metadata = { title: "모델 비교 연구 · 주가예보", robots: { index: false, follow: false } };

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const pp = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}%p`;

export default async function ModelResearchPage() {
  // 로그인한 회원 모두 볼 수 있습니다(로그인 게이트는 proxy). 보고서는 비공개 Storage에서 서버 전용으로 읽습니다.
  const report = await getRankEvaluationReport();
  if (!report) return <main className="shell"><section className="card"><h1 className="sec-title">모델 비교 연구</h1><p>아직 보고서를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p></section></main>;
  const names: Record<string, string> = { technical: "기술 점수", momentum: "12개월 모멘텀", ridge: "선형 순위 모델" };
  return (
    <main className="shell">
      <div className="page-hd"><h1 className="page-hd__t">모델 비교 연구</h1></div>
      <section className="card">
        <h2 className="sec-title">개인 실험 · 채택 보류</h2>
        <p className="sec-desc">다음 거래일 시가 진입 · 20거래일마다 교체 · 상위 20종목 동일비중. 국내와 미국은 각각 현지통화로 비교해요.</p>
        <p className="sec-desc">생존 종목 위주의 과거 자료라 실제 운용 성과와 차이가 있을 수 있어요. 새 순위 모델은 기존 전망 확률에 반영하지 않았어요.</p>
        <p className="caption">계산일 {new Date(report.created_at).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })} · {report.data.stocks}개 주식 · 비용은 매수 {report.settings.buy_bps}bp / 매도 {report.settings.sell_bps}bp 가정이에요. 1bp는 0.01%이며 실제 계좌 요율은 아니에요.</p>
      </section>
      {(["KR", "US"] as const).map((region) => {
        const folds = report.folds.filter((r) => r.region === region);
        return (
          <section key={region} className="card">
            <h2 className="sec-title">{region === "KR" ? "국내" : "미국"} · {folds[0]?.test_from} ~ {folds.at(-1)?.test_to}</h2>
            <p className="caption">시장 비교는 {region === "KR" ? "KODEX200" : "SPY"}예요. 초과수익은 누적 수익률의 차이이며 최대 낙폭은 일별 자산 기준이에요.</p>
            {[1, report.settings.stress_multiplier].map((mult) => (
              <div key={mult}>
                <h3 className="sec-title">{mult === 1 ? "기본 비용" : "비용 2배"}</h3>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", fontSize: 13, borderSpacing: "10px 12px", whiteSpace: "nowrap" }}>
                    <thead><tr><th>전략</th><th>누적 수익</th><th>시장 대비</th><th>최대 낙폭</th><th>거래 수</th><th>연 회전율</th><th>시장 초과 분기</th></tr></thead>
                    <tbody>{report.results.filter((r) => r.region === region && r.cost_multiplier === mult).map((r) => (
                      <tr key={r.model}><th scope="row">{r.name}</th><td>{pct(r.total_return)}</td><td>{pp(r.market_excess)}</td><td>{pct(r.max_drawdown)}</td><td>{r.trade_count}</td><td>{r.annualized_turnover.toFixed(1)}배</td><td>{r.winning_quarters_vs_market}/{r.quarter_count}</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </div>
            ))}
            <details>
              <summary>시작일을 바꿔도 비슷한가요?</summary>
              <p className="caption">교체 시작일을 0·5·10·15거래일 이동했어요. 아래는 기본 비용일 때 시장 대비 누적 수익 차이의 범위예요. 서로 겹치는 검증이므로 독립적인 증거 네 번은 아니에요.</p>
              {Object.entries(names).map(([model, name]) => {
                const rs = [...report.results, ...report.offset_results].filter((r) => r.region === region && r.model === model && r.cost_multiplier === 1);
                return <p key={model} className="sec-desc">{name}: {pp(Math.min(...rs.map((r) => r.market_excess)))} ~ {pp(Math.max(...rs.map((r) => r.market_excess)))}</p>;
              })}
            </details>
            <details>
              <summary>분기별 결과</summary>
              {report.results.filter((r) => r.region === region && r.cost_multiplier === 1).map((r) => (
                <p key={r.model} className="caption">{r.name}: {Object.entries(r.quarters).map(([q, v]) => `${q} ${pct(v)}`).join(" · ")}</p>
              ))}
            </details>
          </section>
        );
      })}
      <section className="card">
        <h2 className="sec-title">해석할 때 확인할 점</h2>
        <ul>{report.limitations.map((s) => <li key={s} className="caption">{s}</li>)}</ul>
        <p className="sec-desc">{report.diagnostics.length}개 실행에서 가격 단절·매매 미체결·평가 가격 누락을 기록했어요. 해당 실행은 거래 내역 확인 전 채택할 수 없어요.</p>
      </section>
      <Link className="btn" href="/account">내 정보로</Link>
    </main>
  );
}
