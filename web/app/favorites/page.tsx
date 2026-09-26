"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import StockRow from "@/components/StockRow";
import { useNavProgress } from "@/components/NavProgress";
import { zoneTone } from "@/lib/format";
import {
  FAVORITES_EVENT,
  FAVORITES_MAX,
  getFavorites,
  removeFavorite,
} from "@/lib/favorites";
import type { FavoriteRow } from "@/lib/db";

type Sort = "signal" | "change" | "name";
const SORTS: { key: Sort; label: string }[] = [
  { key: "signal", label: "점수순" },
  { key: "change", label: "등락순" },
  { key: "name", label: "이름순" },
];

export default function FavoritesPage() {
  const { start } = useNavProgress();
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
    <main className="shell">
      <div className="page-hd">
        <h1 className="page-hd__t">즐겨찾기</h1>
        <span className="page-hd__n num">
          {tickers.length} / {FAVORITES_MAX}
        </span>
      </div>

      {loading && tickers.length > 0 && (
        <section className="card" style={{ gap: 14 }} aria-busy="true">
          <div className="skel" style={{ width: "60%" }} />
          <div className="skel" style={{ width: "80%", height: 26 }} />
          <div className="skel" style={{ width: "100%", height: 38 }} />
        </section>
      )}

      {!loading && tickers.length === 0 && (
        <div className="state">
          <span className="state__ic"><Icon name="star" size={36} /></span>
          <div className="state__t">아직 즐겨찾기가 없어요</div>
          <div className="state__d">
            관심 종목을 검색하고 별표를 누르면 여기에 모여요.
          </div>
          <Link href="/#search" className="btn">
            종목 검색하기
          </Link>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <section className="card card--list" aria-label="즐겨찾기 목록">
          <div className="dist">
            <span className="score up">상승 {dist.buy}</span>
            <span className="score">중립 {dist.neu}</span>
            <span className="score down">하락 {dist.sell}</span>
          </div>
          <div className="seg" role="tablist" aria-label="정렬" style={{ margin: "12px 0 4px" }}>
            {SORTS.map((s) => (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={sort === s.key}
                className={`seg__btn${sort === s.key ? " seg__btn--on" : ""}`}
                onClick={() => setSort(s.key)}
              >
                {s.label}
              </button>
            ))}
          </div>
          {sorted.map((r) => (
            <div className="li-wrap" key={r.ticker}>
              <StockRow row={r} onNavigate={start} />
              <button
                type="button"
                className="iconbtn"
                style={{ color: "var(--faint)" }}
                onClick={() => removeFavorite(r.ticker)}
                aria-label={`${r.name} 즐겨찾기 삭제`}
                title="삭제"
              >
                <Icon name="close" size={18} />
              </button>
            </div>
          ))}
        </section>
      )}

      {tickers.length > 0 && (
        <p className="caption" style={{ textAlign: "center" }}>
          즐겨찾기는 이 브라우저에만 저장돼요.
        </p>
      )}
    </main>
  );
}
