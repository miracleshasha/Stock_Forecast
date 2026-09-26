import type { Macro } from "@/lib/types";
import { formatNum } from "@/lib/format";

function vixWord(v: number | null): string {
  if (v == null) return "—";
  if (v < 16) return "변동성 낮음";
  if (v < 20) return "변동성 보통";
  if (v < 25) return "변동성 높음";
  return "변동성 매우 높음";
}

export default function MarketSummary({ macro }: { macro: Macro | null }) {
  if (!macro) return null;
  const fmt = (v: number | null) =>
    v != null ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  return (
    <div className="idx-row">
      <div className="idx">
        <span className="idx__k">코스피</span>
        <span className="idx__v num">{fmt(macro.kospiClose)}</span>
      </div>
      <div className="idx">
        <span className="idx__k">S&amp;P 500</span>
        <span className="idx__v num">{fmt(macro.spxClose)}</span>
      </div>
      <div className="idx">
        <span className="idx__k">VIX</span>
        <span className="idx__v num">{formatNum(macro.vix, 1)}</span>
        <span className="idx__n">{vixWord(macro.vix)}</span>
      </div>
    </div>
  );
}
