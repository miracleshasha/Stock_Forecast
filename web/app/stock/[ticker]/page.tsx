import { notFound } from "next/navigation";
import StockHeader from "@/components/StockHeader";
import VerdictCard from "@/components/VerdictCard";
import PriceChart from "@/components/PriceChart";
import IndicatorPanel from "@/components/IndicatorPanel";
import ExtrasCard from "@/components/ExtrasCard";
import SetupNotice from "@/components/SetupNotice";
import Icon from "@/components/Icon";
import NewsCard from "@/components/NewsCard";
import { getIndicators, getMacro, getStock, getStockExtras } from "@/lib/db";
import { formatDateKo } from "@/lib/format";
import { getInitialQuote } from "@/lib/liveQuote";
import { getStockNews } from "@/lib/news";
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

  // 종목명·시장이 필요 없는 조회는 getStock 과 함께 먼저 시작합니다
  const indicatorsP = getIndicators(ticker);
  const macroP = getMacro();
  const stock = await getStock(ticker);
  if (!stock) notFound();

  const newsName = stock.symbol.nameKo || stock.symbol.nameEn || stock.symbol.ticker;
  const [indicators, macro, extras, news, initialQuote] = await Promise.all([
    indicatorsP,
    macroP,
    getStockExtras(stock.symbol.ticker, stock.symbol.market),
    getStockNews(newsName, 5),
    // 장중이면 현재가를 먼저 받아 첫 화면부터 실시간 값으로 보여줍니다(장 마감이면 조회 안 함)
    getInitialQuote(stock.symbol, stock.price?.close ?? null),
  ]);
  const hasSignal = stock.signal && stock.signal.zone !== "UNAVAILABLE";

  return (
    <main className="shell">
      {/* 가격 · 차트 */}
      <section className="card stock-top" aria-label="가격">
        <StockHeader symbol={stock.symbol} price={stock.price} initialQuote={initialQuote} />
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

      <NewsCard title="관련 뉴스" items={news} />

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
