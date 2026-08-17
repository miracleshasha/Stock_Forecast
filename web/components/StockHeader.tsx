import type { PriceInfo, Symbol } from "@/lib/types";
import { MARKET_LABEL, changeTone, formatChange, formatPrice } from "@/lib/format";
import FavoriteStar from "./FavoriteStar";

export default function StockHeader({
  symbol,
  price,
}: {
  symbol: Symbol;
  price: PriceInfo | null;
}) {
  const name = symbol.nameKo || symbol.nameEn || symbol.ticker;
  const tone = changeTone(price?.change);
  return (
    <div>
      <div className="sym">
        <div>
          <div className="sym__name">{name}</div>
          <div className="sym__tick">
            {symbol.ticker} · {MARKET_LABEL[symbol.market]} · {symbol.currency}
          </div>
        </div>
        <FavoriteStar ticker={symbol.ticker} market={symbol.market} />
      </div>
      <div className="px">
        <span className={`px__now ${tone}`}>
          {formatPrice(price?.close, symbol.currency)}
        </span>
        <span className={`px__chg ${tone}`}>
          {formatChange(price?.change, price?.changePct, symbol.currency)}
        </span>
        {price?.asOf && <span className="px__asof">{price.asOf} 종가</span>}
      </div>
    </div>
  );
}
