"use client";

import { useState } from "react";
import type { Region, TopRow, TopSignals } from "@/lib/db";
import StockRow from "./StockRow";

const TABS: { key: Region; label: string }[] = [
  { key: "ALL", label: "전체" },
  { key: "KR", label: "국내" },
  { key: "US", label: "해외" },
];

export default function HomeScreener({ top }: { top: TopSignals }) {
  return (
    <>
      <Section
        title="상승 흐름이 강한 종목"
        desc="기술 지표 점수가 높은 순서예요"
        pick={(r) => top[r].buys}
      />
      <Section
        title="하락 흐름이 강한 종목"
        desc="기술 지표 점수가 낮은 순서예요"
        pick={(r) => top[r].sells}
      />
    </>
  );
}

function Section({
  title,
  desc,
  pick,
}: {
  title: string;
  desc: string;
  pick: (r: Region) => TopRow[];
}) {
  const [region, setRegion] = useState<Region>("ALL");
  const rows = pick(region);
  return (
    <section className="card card--list" aria-label={title}>
      <h2 className="sec-title">{title}</h2>
      <p className="sec-desc">{desc}</p>
      <div className="chips" role="tablist" aria-label="시장" style={{ margin: "10px 0 4px" }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={region === t.key}
            className={`chip chip--soft${region === t.key ? " chip--on" : ""}`}
            onClick={() => setRegion(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="li-empty">해당하는 종목이 없어요</p>
      ) : (
        rows.map((r, i) => <StockRow key={r.ticker} row={r} rank={i + 1} />)
      )}
    </section>
  );
}
