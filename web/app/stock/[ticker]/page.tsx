import { notFound } from "next/navigation";
import StockHeader from "@/components/StockHeader";
import VerdictCard from "@/components/VerdictCard";
import PriceChart from "@/components/PriceChart";
import IndicatorPanel from "@/components/IndicatorPanel";
import SetupNotice from "@/components/SetupNotice";
import { getIndicators, getMacro, getStock } from "@/lib/db";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;

  if (!isSupabaseConfigured()) {
    return (
      <main className="shell shell--narrow">
        <SetupNotice />
      </main>
    );
  }

  const stock = await getStock(ticker);
  if (!stock) notFound();

  const [indicators, macro] = await Promise.all([getIndicators(ticker), getMacro()]);

  return (
    <main className="shell shell--narrow">
      {/* 배치 지연 안내 */}
      {stock.price?.asOf && macro?.asOf && stock.price.asOf !== macro.asOf && (
        <div className="quota" style={{ marginBottom: 16 }}>
          <span className="plate">기준일</span>
          <span>
            이 종목의 최신 종가는 <b>{stock.price.asOf}</b> 기준입니다.
          </span>
        </div>
      )}

      {/* 1. 종목명 → 현재가 */}
      <StockHeader symbol={stock.symbol} price={stock.price} />

      {/* 2. 종합 판정 카드 (차트보다 위) */}
      <VerdictCard signal={stock.signal} />

      {/* 3. 차트 */}
      <PriceChart ticker={stock.symbol.ticker} />

      {/* 4. 지표 상세 · 매크로 */}
      {stock.signal && stock.signal.zone !== "UNAVAILABLE" && (
        <IndicatorPanel
          signal={stock.signal}
          indicators={indicators}
          macro={macro}
          close={stock.price?.close ?? null}
          currency={stock.symbol.currency}
        />
      )}
    </main>
  );
}
