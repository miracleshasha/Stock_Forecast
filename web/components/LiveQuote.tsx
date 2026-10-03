"use client";

// ============================================================
// 상단 현재가. 장중이면 실시간 값으로 갱신하고, 그 외에는 확정 종가를 씁니다.
// 서버가 첫 렌더 때 현재가를 받아 왔으면(initial) 그 값으로 바로 시작하고,
// 다음 갱신은 1분 뒤부터 합니다. 못 받아 왔으면 화면이 뜨자마자 받아옵니다.
// 판정 점수·지표는 여기 영향을 받지 않습니다 — 항상 확정 일봉 기준입니다.
// ============================================================

import { useEffect, useState } from "react";
import { changeTone, formatChange, formatDateKo, formatPrice } from "@/lib/format";
import type { Currency, PriceInfo, QuoteResponse } from "@/lib/types";

const REFRESH_MS = 60_000;

export default function LiveQuote({
  ticker,
  currency,
  fallback,
  initial = null,
}: {
  ticker: string;
  currency: Currency;
  fallback: PriceInfo | null;
  initial?: QuoteResponse | null;
}) {
  const [res, setRes] = useState<QuoteResponse | null>(initial);

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

    if (!initial) load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // initial 은 첫 렌더 값일 뿐이라 의존성에서 뺍니다(바뀌어도 다시 구독할 이유가 없음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  const live = res?.live && res.quote ? res.quote : null;
  const price = live ? live.price : fallback?.close;
  const change = live ? live.change : fallback?.change;
  const changePct = live ? live.changePct : fallback?.changePct;
  const tone = changeTone(change);

  return (
    <div className="px">
      <span className="px__now num">{formatPrice(price, currency)}</span>
      <span className={`px__chg num ${tone}`}>
        {formatChange(change, changePct, currency)}
      </span>
      {live ? (
        <span className="px__asof">
          <span className="px__live">실시간</span>
          {new Date(live.fetchedAt).toLocaleTimeString("ko-KR", {
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          기준
        </span>
      ) : (
        fallback?.asOf && (
          <span className="px__asof">{formatDateKo(fallback.asOf)} 종가 · 장중엔 실시간으로 바뀌어요</span>
        )
      )}
    </div>
  );
}
