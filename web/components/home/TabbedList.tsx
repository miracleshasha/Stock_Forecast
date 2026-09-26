"use client";

import { useState } from "react";
import type { HomeRow } from "@/lib/home";
import StockRow from "../StockRow";

export type Badge = { text: string; tone: "up" | "down" | "neu"; label?: string };
export type ListTab = {
  key: string;
  label: string;
  /** 서버에서 배지까지 계산해 넘깁니다(함수는 서버→클라이언트로 못 넘김) */
  items: { row: HomeRow; badge?: Badge }[];
  empty?: string;
};

/** 탭(국내/해외, 신고가/신저가 등)으로 바꿔 보는 종목 목록 카드 */
export default function TabbedList({ title, desc, tabs }: { title: string; desc: string; tabs: ListTab[] }) {
  const [key, setKey] = useState(tabs[0]?.key);
  const tab = tabs.find((t) => t.key === key) ?? tabs[0];
  if (!tab) return null;
  return (
    <section className="card card--list" aria-label={title}>
      <h2 className="sec-title">{title}</h2>
      <p className="sec-desc">{desc}</p>
      <div className="chips" role="tablist" aria-label={title} style={{ margin: "10px 0 4px" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === tab.key}
            className={`chip chip--soft${t.key === tab.key ? " chip--on" : ""}`}
            onClick={() => setKey(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab.items.length === 0 ? (
        <p className="li-empty">{tab.empty ?? "해당하는 종목이 없어요"}</p>
      ) : (
        tab.items.map(({ row, badge }, i) => <StockRow key={row.ticker} row={row} rank={i + 1} badge={badge} />)
      )}
    </section>
  );
}
