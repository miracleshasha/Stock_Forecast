"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import BrandMark from "./BrandMark";
import Icon from "./Icon";

export default function TopBar({ who }: { who: string | null }) {
  const path = usePathname();
  const router = useRouter();
  const onStock = path.startsWith("/stock/");

  return (
    <header className="topbar">
      <div className="topbar__in">
        {onStock ? (
          <button
            type="button"
            className="iconbtn"
            style={{ marginLeft: -12 }}
            aria-label="뒤로"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
          >
            <Icon name="back" />
          </button>
        ) : (
          <Link href="/" className="brand" aria-label="시그널데스크 홈">
            <BrandMark />
            <span aria-hidden>
              <span className="brand__sig">시그널</span>데스크
            </span>
          </Link>
        )}
        {path !== "/login" && (
          <nav className="topnav" aria-label="주요 메뉴">
            <Link href="/" className={path === "/" ? "on" : undefined}>
              홈
            </Link>
            <Link href="/news" className={path === "/news" ? "on" : undefined}>
              뉴스
            </Link>
            <Link href="/favorites" className={path === "/favorites" ? "on" : undefined}>
              즐겨찾기
            </Link>
            {who ? (
              <Link href="/account" className={path === "/account" ? "on" : undefined}>
                내 정보
              </Link>
            ) : (
              <Link href="/login" className={path === "/login" ? "on" : undefined}>
                로그인
              </Link>
            )}
          </nav>
        )}
      </div>
    </header>
  );
}
