"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

type Sort = "signal" | "change" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "signal", label: "시그널순" },
  { key: "change", label: "등락순" },
  { key: "name", label: "이름순" },
];

export default function FavoritesPage() {
  const router = useRouter();
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
      if (sort === "change") return (b.changePct ?? -999) - (a.changePct ?? -999);
      return a.name.localeCompare(b.name, "ko");
    });
    return copy;
  }, [rows, sort]);

  // 시그널 분포 요약
  const dist = useMemo(() => {
    let buy = 0, neu = 0, sell = 0;
    for (const r of rows) {
      const t = r.zone ? zoneTone(r.zone) : "neu";
      if (t === "up") buy++;
      else if (t === "down") sell++;
      else neu++;
    }
    return { buy, neu, sell };
  }, [rows]);

  return (
    <main className="shell shell--narrow">
      <div className="list-head">
        <span className="list-head__t">즐겨찾기</span>
        <span className="plate plate--muted">
          {tickers.length} / {FAVORITES_MAX}
        </span>
      </div>

      {/* 시그널 분포 요약 */}
      {rows.length > 0 && (
        <div className="fav-summary">
          <span className="fav-summary__pill up">매수 {dist.buy}</span>
          <span className="fav-summary__pill neu">중립 {dist.neu}</span>
          <span className="fav-summary__pill down">매도 {dist.sell}</span>
          <div className="seg">
            {SORTS.map((s) => (
              <button
                key={s.key}
                className={`seg__btn${sort === s.key ? " seg__btn--on" : ""}`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      )}

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
            관심 종목을 검색하고 별표를 누르면 여기에 모입니다. 목록에서 종목을 누르면
            바로 상세 판정으로 이동합니다.
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
            <div
              className={`fav fav--${tone}`}
              key={r.ticker}
              role="link"
              tabIndex={0}
              onClick={() => router.push(`/stock/${r.ticker}`)}
              onKeyDown={(e) => e.key === "Enter" && router.push(`/stock/${r.ticker}`)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="fav__nm">{r.name}</div>
                <div className="fav__tk">
                  {r.ticker} · {r.market}
                </div>
              </div>
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
                onClick={(e) => {
                  e.stopPropagation();
                  removeFavorite(r.ticker);
                }}
                aria-label={`${r.name} 즐겨찾기 삭제`}
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
