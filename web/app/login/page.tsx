import Link from "next/link";
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
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const to = safeNext(next === undefined ? "/favorites" : next);
  if (await getSessionUser()) redirect(to);

  return (
    <main className="shell">
      <div className="intro">
        <div className="intro__brand" aria-label="주가예보">
          <BrandMark size={56} />
          <span className="intro__name" aria-hidden>
            주가<span className="brand__sig">예보</span>
          </span>
        </div>
        <p className="intro__t">
          종목을 검색하면
          <br />
          지금 차트 흐름을 한눈에 보여드려요
        </p>
        <p className="sec-desc">
          추세·모멘텀·밴드·거래량을 하나의 점수로 요약해요. 가입 없이 바로 쓸 수 있어요.
        </p>
      </div>
      {/* 앱은 로그인 없이 쓰고, 즐겨찾기·내 정보에 들어갈 때만 이 화면으로 옵니다 */}
      <AuthForm next={to} />
      <p className="caption" style={{ textAlign: "center" }}>
        <Link href="/" className="linkbtn">
          번호 입력 없이 둘러보기
        </Link>
      </p>
    </main>
  );
}
