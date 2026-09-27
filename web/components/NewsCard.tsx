import type { NewsItem } from "@/lib/news";

function ago(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return `${Math.max(1, min)}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}일 전` : new Date(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}

/** 뉴스 목록 — 제목·언론사·시각만, 누르면 원문(새 탭) */
export default function NewsCard({ title, items }: { title: string; items: NewsItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="card" aria-label={title}>
      <div>
        <h2 className="sec-title">{title}</h2>
        <p className="sec-desc">네이버 뉴스 검색 결과예요. 누르면 기사 원문으로 이동해요.</p>
      </div>
      <ul className="news">
        {items.map((n) => (
          <li key={n.url} className="news__item">
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="news__link">
              <span className="news__title">{n.title}</span>
              <span className="news__meta">
                {n.source && <>{n.source} · </>}
                {ago(n.publishedAt)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
