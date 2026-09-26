import SearchBox from "@/components/SearchBox";
import SetupNotice from "@/components/SetupNotice";
import FavoritesSummary from "@/components/home/FavoritesSummary";
import MarketMood from "@/components/home/MarketMood";
import MarketTemps from "@/components/home/MarketTemps";
import SectorFlow from "@/components/home/SectorFlow";
import TabbedList, { type ListTab } from "@/components/home/TabbedList";
import { getSessionUserId } from "@/lib/auth";
import { formatDateKo, formatWonMillion } from "@/lib/format";
import { getHomeData, getInvestorFlows, getMarketTemps, type HomeRow, type RankedRow } from "@/lib/home";
import { isSupabaseConfigured } from "@/lib/supabase";
import { listFavorites } from "@/lib/userFavorites";

export const dynamic = "force-dynamic";

const FAV_PREVIEW = 5;

const pctBadge = (r: RankedRow) => ({
  text: `${r.value > 0 ? "+" : ""}${r.value >= 100 || r.value <= -100 ? r.value.toFixed(0) : r.value.toFixed(1)}%`,
  tone: (r.value > 0 ? "up" : r.value < 0 ? "down" : "neu") as "up" | "down" | "neu",
  label: `12개월 수익률 ${r.value.toFixed(1)}%`,
});
const plain = (rows: HomeRow[]) => rows.map((row) => ({ row }));

export default async function HomePage() {
  if (!isSupabaseConfigured()) {
    return (
      <main className="shell">
        <SetupNotice />
      </main>
    );
  }

  const userId = await getSessionUserId();
  const [home, temps, favs] = await Promise.all([
    getHomeData(5),
    getMarketTemps(),
    userId ? listFavorites(userId).catch(() => []) : Promise.resolve([]),
  ]);
  if (!home) return <main className="shell"><SetupNotice /></main>;
  const flows = await getInvestorFlows(home.byTicker).catch(() => null);

  // 즐겨찾기는 담은 순서 그대로, 최근에 담은 것부터 미리보기
  const favRows = favs
    .slice()
    .reverse()
    .map((f) => home.byTicker.get(f.ticker))
    .filter((r): r is HomeRow => !!r);

  const momentumTabs: ListTab[] = [
    { key: "KR", label: "국내", items: home.momentum.KR.map((r) => ({ row: r, badge: pctBadge(r) })) },
    { key: "US", label: "미국", items: home.momentum.US.map((r) => ({ row: r, badge: pctBadge(r) })) },
  ];

  const moverTabs: ListTab[] = [
    {
      key: "highs",
      label: `52주 신고가 ${home.movers.highs.length}`,
      items: home.movers.highs.slice(0, 5).map((row) => ({ row, badge: { text: "신고가", tone: "up" } })),
      empty: "오늘 52주 신고가를 쓴 종목이 없어요",
    },
    {
      key: "lows",
      label: `52주 신저가 ${home.movers.lows.length}`,
      items: home.movers.lows.slice(0, 5).map((row) => ({ row, badge: { text: "신저가", tone: "down" } })),
      empty: "오늘 52주 신저가를 쓴 종목이 없어요",
    },
    {
      key: "volume",
      label: `거래량 급증 ${home.movers.volume.length}`,
      items: home.movers.volume.slice(0, 5).map((r) => ({
        row: r,
        badge: { text: `${r.value.toFixed(1)}배`, tone: "neu", label: `20일 평균 대비 거래량 ${r.value.toFixed(1)}배` },
      })),
      empty: "오늘 거래량이 평소의 2배를 넘은 종목이 없어요",
    },
  ];

  const investorTabs: ListTab[] = flows
    ? [
        {
          key: "foreign",
          label: "외국인",
          items: flows.foreign.map((r) => ({ row: r, badge: { text: formatWonMillion(r.value), tone: "up", label: `외국인 순매수 ${formatWonMillion(r.value)}원` } })),
          empty: "외국인이 순매수한 종목이 없어요",
        },
        {
          key: "inst",
          label: "기관",
          items: flows.inst.map((r) => ({ row: r, badge: { text: formatWonMillion(r.value), tone: "up", label: `기관 순매수 ${formatWonMillion(r.value)}원` } })),
          empty: "기관이 순매수한 종목이 없어요",
        },
      ]
    : [];

  const flowTabs = (pick: "buys" | "sells"): ListTab[] => [
    { key: "ALL", label: "전체", items: plain(home.top.ALL[pick]) },
    { key: "KR", label: "국내", items: plain(home.top.KR[pick]) },
    { key: "US", label: "해외", items: plain(home.top.US[pick]) },
  ];

  return (
    <main className="shell">
      <h1 className="sr-only">시그널데스크 — 종목 차트 흐름 요약</h1>
      <SearchBox />

      <FavoritesSummary rows={favRows.slice(0, FAV_PREVIEW)} total={favRows.length} />
      <MarketMood KR={home.breadth.KR} US={home.breadth.US} />
      <MarketTemps temps={temps} />
      <TabbedList
        title="12개월 흐름 상위"
        desc="최근 1개월을 뺀 1년 수익률이 높은 종목이에요. 판정 점수와는 별개인 참고 지표예요."
        tabs={momentumTabs}
      />
      <TabbedList title="오늘의 특이 종목" desc="최근 거래일 기준으로 눈에 띄는 움직임이에요." tabs={moverTabs} />
      <SectorFlow KR={home.sectors.KR} US={home.sectors.US} />
      {flows && (
        <TabbedList
          title="외국인·기관 순매수 상위"
          desc={`국내 분석 종목 기준 · ${formatDateKo(flows.date)}`}
          tabs={investorTabs}
          summary={
            <>
              {flows.total.count}종목 합계 ·{" "}
              <span className={flows.total.foreign >= 0 ? "up" : "down"}>외국인 {formatWonMillion(flows.total.foreign)}</span> ·{" "}
              <span className={flows.total.inst >= 0 ? "up" : "down"}>기관 {formatWonMillion(flows.total.inst)}</span> ·{" "}
              <span className={flows.total.indiv >= 0 ? "up" : "down"}>개인 {formatWonMillion(flows.total.indiv)}</span>
            </>
          }
        />
      )}
      <TabbedList title="상승 흐름이 강한 종목" desc="기술 지표 점수가 높은 순서예요" tabs={flowTabs("buys")} />
      <TabbedList title="하락 흐름이 강한 종목" desc="기술 지표 점수가 낮은 순서예요" tabs={flowTabs("sells")} />

      <p className="disc">
        현재 차트 상태를 요약한 정보예요. 앞으로의 수익을 보장하지 않으며, 투자 판단의 책임은
        본인에게 있어요.
      </p>
    </main>
  );
}

