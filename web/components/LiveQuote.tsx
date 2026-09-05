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
        if (!r.ok) return;
        const body = (await r.json()) as QuoteResponse;
        if (alive) setRes(body);
      } catch {
        // 조회 실패는 조용히 무시 — 종가가 그대로 남습니다
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
