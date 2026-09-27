import type { EconEvent } from "@/lib/home";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

function when(e: EconEvent): string {
  const [y, m, d] = e.date.split("-").map(Number);
  const w = WEEK[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}월 ${d}일 (${w})`;
}

function ddayLabel(n: number): string {
  if (n === 0) return "오늘";
  if (n === 1) return "내일";
  return `D-${n}`;
}

/** ⑨ 다가오는 경제 일정 — 공식 발표 일정만(연준·한은·미 노동통계국) */
export default function EconCalendar({ events }: { events: EconEvent[] }) {
  return (
    <section className="card" aria-label="다가오는 경제 일정">
      <div>
        <h2 className="sec-title">다가오는 경제 일정</h2>
        <p className="sec-desc">시장이 주목하는 금리·물가·고용 발표예요. 시각은 한국시간이에요.</p>
      </div>
      {events.length === 0 ? (
        <p className="li-empty">등록된 다음 일정이 없어요</p>
      ) : (
        <ul className="events">
          {events.map((e) => (
            <li className="event" key={`${e.date}-${e.country}-${e.title}`}>
              <span className={`event__dday num${e.dday <= 1 ? " event__dday--soon" : e.dday <= 7 ? " event__dday--week" : ""}`}>{ddayLabel(e.dday)}</span>
              <span className="event__main">
                <span className="event__title">{e.title}</span>
                <span className="event__meta num">
                  {when(e)} · {e.timeKst ?? (e.country === "KR" ? "오전" : "시각 미정")} · {e.country === "KR" ? "한국" : "미국"}
                  {e.detail ? ` · ${e.detail}` : ""}
                </span>
              </span>
              {e.sourceUrl && (
                <a className="event__src" href={e.sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`${e.title} 공식 일정 보기`}>
                  출처
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
