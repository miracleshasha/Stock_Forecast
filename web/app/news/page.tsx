import NewsCard from "@/components/NewsCard";
import SetupNotice from "@/components/SetupNotice";
import EconCalendar from "@/components/home/EconCalendar";
import { getUpcomingEvents } from "@/lib/home";
import { getMarketNews } from "@/lib/news";
import { isSupabaseConfigured } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function NewsPage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="shell">
        <SetupNotice />
      </main>
    );
  }

  const [news, events] = await Promise.all([getMarketNews(10), getUpcomingEvents(8).catch(() => [])]);

  return (
    <main className="shell">
      <div className="page-hd">
        <h1 className="page-hd__t">뉴스</h1>
      </div>
      {news.length > 0 ? (
        <NewsCard title="시장 뉴스" items={news} />
      ) : (
        <section className="card" aria-label="시장 뉴스">
          <h2 className="sec-title">시장 뉴스</h2>
          <p className="li-empty">지금은 뉴스를 불러오지 못했어요. 잠시 뒤 다시 확인해 주세요.</p>
        </section>
      )}
      <EconCalendar events={events} />
    </main>
  );
}
