import Link from "next/link";
import type { Currency, Market } from "@/lib/types";
import { MARKET_LABEL, changeTone, formatPct, formatPrice, formatScore, initial } from "@/lib/format";

export interface StockRowData {
  ticker: string;
  name: string;
  market: Market;
  currency: Currency;
  price: number | null;
  changePct: number | null;
  score: number | null;
}

/** 목록 한 줄: 순위 · 이니셜 · 종목명 · 현재가/등락률 · 점수 배지 */
export default function StockRow({
  row,
  rank,
  onNavigate,
  badge,
}: {
  row: StockRowData;
  rank?: number;
  onNavigate?: () => void;
  /** 점수 대신 보여줄 배지(예: 12개월 수익률, 거래량 배수) */
  badge?: { text: string; tone: "up" | "down" | "neu"; label?: string };
}) {
  const scoreTone = row.score == null ? "neu" : row.score > 0 ? "up" : row.score < 0 ? "down" : "neu";
  return (
    <Link href={`/stock/${row.ticker}`} className="li" onClick={onNavigate}>
      {rank != null && <span className="li__rank num">{rank}</span>}
      <span className="li__avatar" aria-hidden>
        {initial(row.name)}
      </span>
      <span className="li__main">
        <span className="li__name">{row.name}</span>
        <span className="li__meta">
          {row.ticker} · {MARKET_LABEL[row.market] ?? row.market}
        </span>
      </span>
      <span className="li__px">
        <span className="li__price num">{formatPrice(row.price, row.currency)}</span>
        <span className={`li__chg num ${changeTone(row.changePct)}`}>{formatPct(row.changePct)}</span>
      </span>
      {badge ? (
        <span className={`score num ${badge.tone}`} aria-label={badge.label ?? badge.text}>
          {badge.text}
        </span>
      ) : (
        <span className={`score num ${scoreTone}`} aria-label={`점수 ${row.score ?? "없음"}`}>
          {row.score == null ? "—" : formatScore(row.score)}
        </span>
      )}
    </Link>
  );
}
