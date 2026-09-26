import type { PriceInfo, Symbol } from "@/lib/types";
import { MARKET_LABEL } from "@/lib/format";
import FavoriteStar from "./FavoriteStar";
import LiveQuote from "./LiveQuote";

export default function StockHeader({
  symbol,
  price,
}: {
  symbol: Symbol;
  price: PriceInfo | null;
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
      <LiveQuote ticker={symbol.ticker} currency={symbol.currency} fallback={price} />
    </div>
  );
}
