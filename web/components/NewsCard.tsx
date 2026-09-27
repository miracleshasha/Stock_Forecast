import type { NewsItem } from "@/lib/news";

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${Math.max(1, min)}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}일 전` : new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

// 제목 키워드로 본 기사 논조. 한쪽 단어만 있을 때만 표시합니다(둘 다 있거나 없으면 표시 안 함).
const UP_WORDS = /상승|강세|급등|반등|회복|최고치|신고가|랠리|돌파|오름세|올라|↑/;
const DOWN_WORDS = /하락|약세|급락|폭락|반락|최저치|신저가|떨어|내려|밀려|후퇴|↓/;

function headlineTone(title: string): "up" | "down" | null {
  const up = UP_WORDS.test(title);
  const down = DOWN_WORDS.test(title);
  return up === down ? null : up ? "up" : "down";
}

/** 뉴스 목록 — 제목·언론사·시각만, 누르면 원문(새 탭). mood면 상단에 상승/하락 논조 비율 막대. */
export default function NewsCard({ title, items, mood = false }: { title: string; items: NewsItem[]; mood?: boolean }) {
  if (items.length === 0) return null;
  const tones = items.map((n) => headlineTone(n.title));
  const nUp = tones.filter((t) => t === "up").length;
  const nDown = tones.filter((t) => t === "down").length;

  return (
    <section className="card" aria-label={title}>
      <div>
        <h2 className="sec-title">{title}</h2>
        <p className="sec-desc">네이버 뉴스 검색 결과예요. 누르면 기사 원문으로 이동해요.</p>
      </div>
      {mood && nUp + nDown > 0 && (
        <div className="nmood">
          <div className="nmood__lbl">
            <span className="up">상승 기사 {nUp}</span>
            <span className="nmood__k">헤드라인 분위기</span>
            <span className="down">하락 기사 {nDown}</span>
          </div>
          <div className="nmood__bar" role="img" aria-label={`제목 기준 상승 기사 ${nUp}건, 하락 기사 ${nDown}건`}>
            <span className="nmood__up" style={{ flex: nUp }} />
            <span className="nmood__down" style={{ flex: nDown }} />
          </div>
        </div>
      )}
      <ul className="news">
        {items.map((n, i) => {
          const tone = tones[i];
          return (
            <li key={n.url} className={`news__item${tone ? ` news__item--${tone}` : ""}`}>
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="news__link">
                {(n.market || tone) && (
                  <span className="news__tags">
                    {n.market && (
                      <span className={`ntag ntag--${n.market.toLowerCase()}`}>{n.market === "KR" ? "국내" : "미국"}</span>
                    )}
                    {tone && <span className={`ntag ntag--${tone}`}>{tone === "up" ? "▲ 상승" : "▼ 하락"}</span>}
                  </span>
                )}
                <span className="news__title">{n.title}</span>
                <span className="news__meta">
                  {n.source && <>{n.source} · </>}
                  {ago(n.publishedAt)}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
