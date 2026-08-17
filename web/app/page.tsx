import SearchBox from "@/components/SearchBox";
import MarketSummary from "@/components/MarketSummary";
import SetupNotice from "@/components/SetupNotice";
import { getMacro } from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const configured = isSupabaseConfigured();
  const macro = configured ? await getMacro() : null;

  return (
    <main className="shell shell--narrow">
      <div className="hero">
        {macro?.asOf && (
          <div className="plate plate--muted" style={{ marginBottom: 18 }}>
            {macro.asOf} 종가 기준
          </div>
        )}
        <h1 className="hero__title">
          종목을 검색하면
          <br />
          지금이 <span>어떤 구간</span>인지 알려드립니다
        </h1>
        <p className="hero__sub">기술적 지표 8종 + 매크로 4종을 합산한 단일 점수</p>
      </div>

      <SearchBox autoFocus />

      {!configured ? <SetupNotice /> : <MarketSummary macro={macro} />}
    </main>
  );
}
