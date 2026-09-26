import { notFound } from "next/navigation";
import StockHeader from "@/components/StockHeader";
import VerdictCard from "@/components/VerdictCard";
import PriceChart from "@/components/PriceChart";
import IndicatorPanel from "@/components/IndicatorPanel";
import ExtrasCard from "@/components/ExtrasCard";
import SetupNotice from "@/components/SetupNotice";
import Icon from "@/components/Icon";
import { getIndicators, getMacro, getStock, getStockExtras } from "@/lib/db";
import { formatDateKo } from "@/lib/format";
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
      <main className="shell">
        <SetupNotice />
      </main>
    );
  }

  const stock = await getStock(ticker);
  if (!stock) notFound();

  const [indicators, macro, extras] = await Promise.all([
    getIndicators(ticker),
    getMacro(),
    getStockExtras(stock.symbol.ticker, stock.symbol.market),
  ]);
  const hasSignal = stock.signal && stock.signal.zone !== "UNAVAILABLE";

  return (
    <main className="shell">
      {/* 가격 · 차트 */}
      <section className="card stock-top" aria-label="가격">
        <StockHeader symbol={stock.symbol} price={stock.price} />
        <PriceChart ticker={stock.symbol.ticker} currency={stock.symbol.currency} />
      </section>

      {/* 배치 지연 안내 */}
      {stock.price?.asOf && macro?.asOf && stock.price.asOf < macro.asOf && (
        <p className="notice">
          이 종목의 최신 종가는 <b>{formatDateKo(stock.price.asOf)}</b> 기준이에요.
        </p>
      )}

      <VerdictCard signal={stock.signal} />

      {hasSignal && (
        <IndicatorPanel
          signal={stock.signal!}
          indicators={indicators}
          close={stock.price?.close ?? null}
        />
      )}

      <ExtrasCard
        extras={extras}
        macro={macro}
        damp={stock.signal?.breakdown.damp}
        currency={stock.symbol.currency}
      />

      <p className="disc">
        <Icon name="info" size={16} />
        <span>
          점수는 기술 지표로 현재 차트 상태를 요약한 값이에요. 백테스트에서 미래 수익 예측력은
          확인되지 않았으니 투자 판단의 참고로만 봐 주세요. 투자 판단과 그 결과의 책임은 본인에게
          있어요.
        </span>
      </p>
    </main>
  );
}
