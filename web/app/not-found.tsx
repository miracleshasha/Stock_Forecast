import Link from "next/link";
import Icon from "@/components/Icon";

export default function NotFound() {
  return (
    <main className="shell">
      <div className="state" style={{ marginTop: 24 }}>
        <span className="state__ic"><Icon name="search" size={36} /></span>
        <h1 className="state__t">종목을 찾을 수 없어요</h1>
        <p className="state__d">
          아직 지원하지 않는 종목이거나 데이터가 들어오지 않았어요.
        </p>
        <Link href="/" className="btn">
          홈으로
        </Link>
      </div>
    </main>
  );
}
