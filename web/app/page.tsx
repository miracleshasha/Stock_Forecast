import SearchBox from "@/components/SearchBox";
import MarketSummary from "@/components/MarketSummary";
import SetupNotice from "@/components/SetupNotice";
import HomeScreener from "@/components/HomeScreener";
import { getMacro, getTopSignals } from "@/lib/db";
import { formatDateKo } from "@/lib/format";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  const [macro, top] = configured
    ? await Promise.all([getMacro(), getTopSignals(5)])
    : [null, null];

  return (
    <main className="shell">
      <h1 className="sr-only">시그널데스크 — 종목 차트 흐름 요약</h1>
      <SearchBox />

      {!configured || !top ? (
        <SetupNotice />
      ) : (
        <>
          <p className="caption" style={{ marginTop: 8 }}>
            {macro?.asOf ? `${formatDateKo(macro.asOf)} 종가 기준 · ` : ""}장중엔 현재가만 실시간
          </p>
          <MarketSummary macro={macro} />
          <HomeScreener top={top} />
          <p className="disc">
            현재 차트 상태를 요약한 정보예요. 앞으로의 수익을 보장하지 않으며, 투자 판단의 책임은
            본인에게 있어요.
          </p>
        </>
      )}
    </main>
  );
}
