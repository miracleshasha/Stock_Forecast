"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function TopBar() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar__in">
        <Link href="/" className="brand">
          <span className="brand__mark">
            SIGNAL<span>·</span>DESK
          </span>
          <span className="brand__sub">판정 종가 기준 · 현재가 실시간</span>
        </Link>
        <nav className="navlinks">
          <Link href="/favorites" className={path === "/favorites" ? "on" : undefined}>
            즐겨찾기
          </Link>
        </nav>
      </div>
    </header>
  );
}
