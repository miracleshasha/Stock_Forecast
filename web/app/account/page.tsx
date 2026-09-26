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
          <span>가입일</span>
          <span>{joined}</span>
        </div>
      </section>
      <section className="card">
        <p className="sec-desc">
          즐겨찾기는 계정에 저장돼서 다른 기기에서 로그인해도 그대로 보여요.
        </p>
        <LogoutButton />
      </section>
    </main>
  );
}
