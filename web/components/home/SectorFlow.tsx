"use client";

import { useState } from "react";
import type { SectorStat } from "@/lib/home";
import { formatPct } from "@/lib/format";

const MAX = 6;

function SectorRow({ s }: { s: SectorStat }) {
  const pct = (n: number) => `${(n / s.count) * 100}%`;
  const avg = Math.round(s.avgScore);
  const tone = avg >= 15 ? "up" : avg <= -15 ? "down" : "";
  return (
    <div className="sector">
      <div className="sector__hd">
        <span className="sector__name">{s.name}</span>
        <span className="sector__n num">{s.count}종목</span>
        {s.avgChange != null && (
          <span className={`sector__chg num ${s.avgChange > 0 ? "up" : s.avgChange < 0 ? "down" : ""}`}>
            {formatPct(s.avgChange)}
          </span>
        )}
        <span className={`score num ${tone}`} aria-label={`평균 점수 ${avg}`}>
          {avg > 0 ? `+${avg}` : avg}
        </span>
      </div>
      <div className="mood__bar mood__bar--thin" role="img" aria-label={`상승 흐름 ${s.up}, 중립 ${s.neutral}, 하락 흐름 ${s.down}`}>
        <span className="mood__seg mood__seg--up" style={{ width: pct(s.up) }} />
        <span className="mood__seg mood__seg--neu" style={{ width: pct(s.neutral) }} />
        <span className="mood__seg mood__seg--down" style={{ width: pct(s.down) }} />
      </div>
    </div>
  );
}

/** ⑥ 업종별 흐름 — 업종 평균 점수 순. 강한 쪽/약한 쪽 각각 3개씩 먼저 보여주고 펼칠 수 있게 */
export default function SectorFlow({ KR, US }: { KR: SectorStat[]; US: SectorStat[] }) {
  const [region, setRegion] = useState<"KR" | "US">("KR");
  const [all, setAll] = useState(false);
  const list = region === "KR" ? KR : US;
  const shown = all || list.length <= MAX ? list : [...list.slice(0, MAX / 2), ...list.slice(-MAX / 2)];
  return (
    <section className="card" aria-label="업종별 흐름">
      <div>
        <h2 className="sec-title">업종별 흐름</h2>
        <p className="sec-desc">업종 안 종목들의 평균 점수와 상승·하락 흐름 비율이에요. 오른쪽 %는 최근 거래일 평균 등락률이에요.</p>
      </div>
      <div className="chips" role="tablist" aria-label="시장">
        {(["KR", "US"] as const).map((r) => (
          <button
            key={r}
            type="button"
            role="tab"
            aria-selected={region === r}
            className={`chip chip--soft${region === r ? " chip--on" : ""}`}
            onClick={() => {
              setRegion(r);
              setAll(false);
            }}
          >
            {r === "KR" ? "국내" : "미국"}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <p className="li-empty">업종 정보가 아직 없어요</p>
      ) : (
        <div className="sectors">
          {shown.map((s, i) => (
            <div key={s.name}>
              {!all && list.length > MAX && i === MAX / 2 && <div className="sector__gap" aria-hidden>···</div>}
              <SectorRow s={s} />
            </div>
          ))}
        </div>
      )}
      {list.length > MAX && (
        <button type="button" className="btn btn--soft btn--block" style={{ height: 44, marginTop: 0 }} onClick={() => setAll((v) => !v)}>
          {all ? "접기" : `전체 ${list.length}개 업종 보기`}
        </button>
      )}
    </section>
  );
}
