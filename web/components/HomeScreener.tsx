import Link from "next/link";
import type { TopRow } from "@/lib/db";
import { MiniGauge } from "./SignalGauge";
import { ZONE_LABEL, changeTone, formatPct, formatPrice, zoneTone } from "@/lib/format";

export default function HomeScreener({
  buys,
  sells,
}: {
  buys: TopRow[];
  sells: TopRow[];
}) {
  if (buys.length === 0 && sells.length === 0) return null;
  return (
    <div className="screener">
      <ScreenerCol title="오늘 매수 신호 TOP" rows={buys} accent="up" />
      <ScreenerCol title="오늘 매도 신호 TOP" rows={sells} accent="down" />
    </div>
  );
}

function ScreenerCol({
  title,
  rows,
  accent,
}: {
  title: string;
  rows: TopRow[];
  accent: "up" | "down";
}) {
  return (
    <div className="screener__col">
      <div className={`screener__hd ${accent}`}>{title}</div>
      {rows.map((r, i) => {
        const tone = zoneTone(r.zone);
        return (
          <Link href={`/stock/${r.ticker}`} className="screener__row" key={r.ticker}>
            <span className="screener__rank">{i + 1}</span>
            <span className="screener__name">
              <b>{r.name}</b>
              <small>{r.market}</small>
            </span>
            <span className="screener__gauge">
              <MiniGauge score={r.score} />
              <span className={`screener__zone ${tone}`}>
                {ZONE_LABEL[r.zone]} {r.score > 0 ? `+${r.score}` : r.score}
              </span>
            </span>
            <span className={`screener__px ${changeTone(r.changePct)}`}>
              {formatPrice(r.price, r.currency)}
              <br />
              <small>{formatPct(r.changePct)}</small>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
