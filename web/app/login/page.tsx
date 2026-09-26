import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
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
      <AuthForm initialMode={mode === "signup" ? "signup" : "login"} next={to} />
    </main>
  );
}
