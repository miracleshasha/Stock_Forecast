import { formatDateKo } from "@/lib/format";
import { getFreshness } from "@/lib/freshness";

/** 배치가 멈춰 데이터가 밀렸을 때만 모든 화면 위에 한 줄 알림을 띄웁니다. */
export default async function StaleNotice() {
  const f = await getFreshness();
  if (!f.stale) return null;
  return (
    <div className="stale" role="status">
      <p className="stale__in">
        데이터 업데이트가 지연되고 있어요. 점수·종가는 <b>{formatDateKo(f.lastDate)}</b> 기준이에요.
      </p>
    </div>
  );
}
