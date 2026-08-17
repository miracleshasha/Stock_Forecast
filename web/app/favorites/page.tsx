"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MiniGauge } from "@/components/SignalGauge";
import {
  ZONE_LABEL,
  changeTone,
  formatPct,
  formatPrice,
  zoneTone,
} from "@/lib/format";
import {
  FAVORITES_EVENT,
  FAVORITES_MAX,
  getFavorites,
  removeFavorite,
} from "@/lib/favorites";
import type { FavoriteRow } from "@/lib/db";

type Sort = "signal" | "change";

export default function FavoritesPage() {
  const [tickers, setTickers] = useState<string[]>([]);
  const [rows, setRows] = useState<FavoriteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<Sort>("signal");

  useEffect(() => {
    const sync = () => setTickers(getFavorites().map((f) => f.ticker));
    sync();
    window.addEventListener(FAVORITES_EVENT, sync);
    return () => window.removeEventListener(FAVORITES_EVENT, sync);
  }, []);

  useEffect(() => {
    if (tickers.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/favorites?tickers=${tickers.join(",")}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: FavoriteRow[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [tickers]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      if (sort === "signal") return (b.score ?? -999) - (a.score ?? -999);
      return (b.changePct ?? -999) - (a.changePct ?? -999);
    });
    return copy;
  }, [rows, sort]);

  return (
    <main className="shell shell--narrow">
      <div className="list-head">
        <span className="list-head__t">즐겨찾기</span>
        <span className="plate plate--muted">
          {tickers.length} / {FAVORITES_MAX}
        </span>
        <button
          className="sort"
          onClick={() => setSort((s) => (s === "signal" ? "change" : "signal"))}
        >
          {sort === "signal" ? "시그널순 ▾" : "등락순 ▾"}
        </button>
      </div>

      {loading && tickers.length > 0 && (
        <div className="state">
          <div className="skel" style={{ width: "60%" }} />
          <div className="skel" style={{ width: "80%", height: 26 }} />
          <div className="skel" style={{ width: "100%", height: 38 }} />
        </div>
      )}

      {!loading && tickers.length === 0 && (
        <div className="state">
          <div className="state__ic">☆</div>
          <div className="state__t">아직 즐겨찾기가 없습니다</div>
          <div className="state__d">
            관심 종목을 검색하고 별표를 누르면 여기에 모입니다.
          </div>
          <Link href="/" className="state__btn">
            종목 검색하기
          </Link>
        </div>
      )}

      {!loading &&
        sorted.map((r) => {
          const tone = r.zone ? zoneTone(r.zone) : "neu";
          return (
            <div className="fav" key={r.ticker}>
              <Link href={`/stock/${r.ticker}`} style={{ minWidth: 0 }}>
                <div className="fav__nm">{r.name}</div>
                <div className="fav__tk">
                  {r.ticker} · {r.market}
                </div>
              </Link>
              <div className="fav__gauge">
                {r.score != null ? (
                  <>
                    <MiniGauge score={r.score} />
                    <div className={`fav__zone ${tone}`}>
                      {r.zone ? ZONE_LABEL[r.zone] : ""}{" "}
                      {r.score > 0 ? `+${r.score}` : r.score}
                    </div>
                  </>
                ) : (
                  <div className="fav__zone neu">판정 없음</div>
                )}
              </div>
              <div className={`fav__px ${changeTone(r.changePct)}`}>
                {formatPrice(r.price, r.currency)}
                <br />
                <small>{formatPct(r.changePct)}</small>
              </div>
              <button
                className="fav__rm"
                onClick={() => removeFavorite(r.ticker)}
                aria-label="즐겨찾기 삭제"
                title="삭제"
              >
                ✕
              </button>
            </div>
          );
        })}

      {tickers.length > 0 && (
        <div className="note-box">
          현재 즐겨찾기는 이 브라우저에만 저장됩니다. 로그인하면 기기 간 동기화됩니다.{" "}
          <span>(2차 예정)</span>
        </div>
      )}
    </main>
  );
}
