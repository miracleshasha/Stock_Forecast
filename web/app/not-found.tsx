import Link from "next/link";

export default function NotFound() {
  return (
    <main className="shell shell--narrow">
      <div className="state" style={{ marginTop: 40 }}>
        <div className="state__ic">?</div>
        <div className="state__t">해당 종목을 찾을 수 없습니다</div>
        <div className="state__d">
          현재 지원 유니버스에 없는 종목이거나, 아직 데이터가 적재되지 않았습니다.
        </div>
        <Link href="/" className="state__btn">
          홈으로
        </Link>
      </div>
    </main>
  );
}
