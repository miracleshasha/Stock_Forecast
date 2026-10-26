import Link from "next/link";
import { canViewModelResearch } from "@/lib/model-access";
import { redirect } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import { emailToPhone, getSessionUser } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/account");

  const phone = user.user_metadata?.phone
    ? formatPhone(String(user.user_metadata.phone))
    : emailToPhone(user.email);
  const joined = new Date(user.created_at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="shell">
      <div className="page-hd">
        <h1 className="page-hd__t">내 정보</h1>
      </div>
      <section className="card">
        <div className="kv">
          <span>휴대폰 번호</span>
          <span className="num">{phone}</span>
        </div>
        <div className="kv">
          <span>처음 들어온 날</span>
          <span>{joined}</span>
        </div>
      </section>
      {canViewModelResearch(user) && (
        <section className="card">
          <h2 className="sec-title">나만 보는 모델 연구</h2>
          <p className="sec-desc">비용과 위험을 반영한 20일 종목 순위 모델 비교예요.</p>
          <Link className="btn" href="/research">모델 비교 결과 보기</Link>
        </section>
      )}
      <section className="card">
        <p className="sec-desc">
          즐겨찾기는 이 번호에 저장돼서 다른 기기에서 같은 번호를 넣어도 그대로 보여요.
        </p>
        <LogoutButton />
      </section>
    </main>
  );
}
