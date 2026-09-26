import Link from "next/link";
import type { HomeRow } from "@/lib/home";
import OpenSearchButton from "../OpenSearchButton";
import StockRow from "../StockRow";

/** ② 내 관심 종목 — 계정 즐겨찾기의 오늘 등락과 흐름 */
export default function FavoritesSummary({ rows, total }: { rows: HomeRow[]; total: number }) {
  return (
    <section className="card card--list" aria-label="내 관심 종목">
      <div className="sec-hd">
        <h2 className="sec-title">내 관심 종목</h2>
        {total > 0 && (
          <Link href="/favorites" className="sec-more">
            {total > rows.length ? `전체 ${total}개` : "편집"}
          </Link>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="empty-mini">
          <p className="sec-desc">종목 화면에서 별표를 누르면 여기에서 매일 확인할 수 있어요.</p>
          <OpenSearchButton className="btn btn--soft">종목 찾아보기</OpenSearchButton>
        </div>
      ) : (
        rows.map((r) => <StockRow key={r.ticker} row={r} />)
      )}
    </section>
  );
}
