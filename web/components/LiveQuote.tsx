"use client";

// ============================================================
// 상단 현재가. 장중이면 실시간 값으로 갱신하고, 그 외에는 확정 종가를 씁니다.
// 판정 점수·지표는 여기 영향을 받지 않습니다 — 항상 확정 일봉 기준입니다.
// ============================================================

import { useEffect, useState } from "react";
import { changeTone, formatChange, formatPrice } from "@/lib/format";
import type { Currency, PriceInfo, QuoteResponse } from "@/lib/types";

const REFRESH_MS = 60_000;

export default function LiveQuote({
  ticker,
  currency,
  fallback,
}: {
  ticker: string;
  currency: Currency;
  fallback: PriceInfo | null;
}) {
  const [res, setRes] = useState<QuoteResponse | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const r = await fetch(
          `/api/stock/${encodeURIComponent(ticker)}/quote`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          console.warn(`[LiveQuote] ${ticker} 응답 ${r.status} — 종가로 표시합니다`);
          return;
        }
        const body = (await r.json()) as QuoteResponse;
        if (alive) setRes(body);
      } catch (e) {
        // 화면은 종가로 폴백하되, 왜 실시간이 안 뜨는지는 콘솔에 남깁니다.
        // (조용히 삼키면 장 마감인지 조회 실패인지 구분할 수 없습니다)
        console.warn(`[LiveQuote] ${ticker} 조회 실패 — 종가로 표시합니다`, e);
      }
    }

    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [ticker]);

  const live = res?.live && res.quote ? res.quote : null;
  const price = live ? live.price : fallback?.close;
  const change = live ? live.change : fallback?.change;
  const changePct = live ? live.changePct : fallback?.changePct;
  const tone = changeTone(change);

  return (
    <div className="px">
      <span className={`px__now ${tone}`}>{formatPrice(price, currency)}</span>
      <span className={`px__chg ${tone}`}>
        {formatChange(change, changePct, currency)}
      </span>
      {live ? (
        <span className="px__asof">
          <span className="px__live">실시간</span>
          {new Date(live.fetchedAt).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </span>
      ) : (
        fallback?.asOf && <span className="px__asof">{fallback.asOf} 종가</span>
      )}
    </div>
  );
}
