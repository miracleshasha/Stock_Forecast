import type { Macro } from "@/lib/types";
import { formatNum } from "@/lib/format";

export default function MarketSummary({ macro }: { macro: Macro | null }) {
  if (!macro) return null;
  return (
    <div className="market-row">
      <div className="card">
        <div className="card__hd">
          <span className="card__t">KOSPI</span>
          <span className="card__v">
            {macro.kospiClose != null ? macro.kospiClose.toLocaleString() : "—"}
          </span>
        </div>
        <div className="row">
          <span className="pip pip--neu" />
          <span className="row__k">VKOSPI</span>
          <span className="row__v">{formatNum(macro.vkospi, 1)}</span>
        </div>
      </div>
      <div className="card">
        <div className="card__hd">
          <span className="card__t">S&amp;P 500</span>
          <span className="card__v">
            {macro.spxClose != null ? macro.spxClose.toLocaleString() : "—"}
          </span>
        </div>
        <div className="row">
          <span className="pip pip--neu" />
          <span className="row__k">VIX</span>
          <span className="row__v">{formatNum(macro.vix, 1)}</span>
        </div>
      </div>
    </div>
  );
}
