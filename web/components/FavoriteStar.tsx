"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/lib/types";
import { FAVORITES_EVENT, isFavorite, toggleFavorite } from "@/lib/favorites";

export default function FavoriteStar({
  ticker,
  market,
}: {
  ticker: string;
  market: Market;
}) {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(isFavorite(ticker));
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, [ticker]);

  return (
    <button
      className={`star${on ? " star--on" : ""}`}
      onClick={() => setOn(toggleFavorite(ticker, market))}
      aria-pressed={on}
      aria-label={on ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      title={on ? "즐겨찾기 해제" : "즐겨찾기 추가"}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
