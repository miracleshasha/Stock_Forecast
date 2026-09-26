"use client";

import { useEffect, useState } from "react";
import type { Market } from "@/lib/types";
import { FAVORITES_EVENT, isFavorite, loadFavorites, toggleFavorite } from "@/lib/favorites";
import Icon from "./Icon";

export default function FavoriteStar({
  ticker,
  market,
}: {
  ticker: string;
  market: Market;
}) {
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sync = () => setOn(isFavorite(ticker));
    window.addEventListener(FAVORITES_EVENT, sync);
    loadFavorites().then(sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, [ticker]);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      setOn(await toggleFavorite(ticker, market));
    } catch (e) {
      window.alert(e instanceof Error && e.message !== "unauthorized" ? e.message : "잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`iconbtn star${on ? " star--on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      aria-busy={busy}
      aria-label={on ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      title={on ? "즐겨찾기 해제" : "즐겨찾기 추가"}
    >
      <Icon name="star" filled={on} size={26} />
    </button>
  );
}
