import type { PriceInfo, QuoteResponse, Symbol } from "@/lib/types";
import { MARKET_LABEL } from "@/lib/format";
import FavoriteStar from "./FavoriteStar";
import LiveQuote from "./LiveQuote";

export default function StockHeader({
  symbol,
  price,
  initialQuote = null,
}: {
  symbol: Symbol;
  price: PriceInfo | null;
  /** 서버가 첫 렌더 때 받아 둔 현재가(장중일 때만) */
  initialQuote?: QuoteResponse | null;
}) {
  const name = symbol.nameKo || symbol.nameEn || symbol.ticker;
  return (
    <div>
      <div className="sym">
        <div>
          <h1 className="sym__name">{name}</h1>
          <div className="sym__meta">
            {symbol.ticker} · {MARKET_LABEL[symbol.market] ?? symbol.market}
          </div>
        </div>
        <FavoriteStar ticker={symbol.ticker} market={symbol.market} />
      </div>
      {/* key: 종목을 옮겨 다녀도 이전 종목의 현재가 상태가 남지 않게 새로 마운트 */}
      <LiveQuote
        key={symbol.ticker}
        ticker={symbol.ticker}
        currency={symbol.currency}
        fallback={price}
        initial={initialQuote}
      />
    </div>
  );
}
