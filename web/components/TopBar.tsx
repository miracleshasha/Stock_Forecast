"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import Icon from "./Icon";

export default function TopBar() {
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
          <Link href="/" className="brand">
            시그널데스크
          </Link>
        )}
        <nav className="topnav" aria-label="주요 메뉴">
          <Link href="/" className={path === "/" ? "on" : undefined}>
            홈
          </Link>
          <Link href="/favorites" className={path === "/favorites" ? "on" : undefined}>
            즐겨찾기
          </Link>
        </nav>
        {!onStock && (
          <Link href="/favorites" className="iconbtn iconbtn--end" aria-label="즐겨찾기">
            <Icon name="star" />
          </Link>
        )}
      </div>
    </header>
  );
}
