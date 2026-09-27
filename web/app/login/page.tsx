import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import BrandMark from "@/components/BrandMark";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** 외부 주소로 튕기지 않도록 앱 안의 경로만 허용 */
function safeNext(v: string | undefined): string {
  return v && v.startsWith("/") && !v.startsWith("//") ? v : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; next?: string }>;
}) {
  const { mode, next } = await searchParams;
  const to = safeNext(next);
  if (await getSessionUser()) redirect(to);

  return (
    <main className="shell">
      <div className="intro">
        <div className="intro__brand" aria-label="시그널데스크">
          <BrandMark size={56} />
          <span className="intro__name" aria-hidden>
            <span className="brand__sig">시그널</span>데스크
          </span>
        </div>
        <p className="intro__t">
          종목을 검색하면
          <br />
          지금 차트 흐름을 한눈에 보여드려요
        </p>
        <p className="sec-desc">
          추세·모멘텀·밴드·거래량을 하나의 점수로 요약해요. 가입하면 바로 쓸 수 있어요.
        </p>
      </div>
      {/* 로그인은 자동으로 유지되므로 이 화면을 보는 사람은 대부분 처음 온 사람 → 가입이 기본 */}
      <AuthForm initialMode={mode === "login" ? "login" : "signup"} next={to} />
    </main>
  );
}
