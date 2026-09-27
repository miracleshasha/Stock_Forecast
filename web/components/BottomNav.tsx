"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "./Icon";

type Item = { href: string; label: string; icon: IconName; match: (p: string) => boolean };

/** 모바일 하단 탭. 768px 이상에서는 CSS로 숨기고 상단 메뉴를 씁니다. */
export default function BottomNav({ who }: { who: string | null }) {
  const path = usePathname();
  if (path === "/login") return null; // 가입 전엔 갈 수 있는 곳이 없음

  const items: Item[] = [
    { href: "/", label: "홈", icon: "home", match: (p) => p === "/" },
    { href: "/news", label: "뉴스", icon: "news", match: (p) => p === "/news" },
    { href: "/favorites", label: "즐겨찾기", icon: "star", match: (p) => p === "/favorites" },
    who
      ? { href: "/account", label: "내 정보", icon: "user", match: (p) => p === "/account" }
      : { href: "/login", label: "로그인", icon: "user", match: (p) => p === "/login" },
  ];
  const link = (it: Item) => {
    const on = it.match(path);
    return (
      <Link key={it.label} href={it.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
        <span className="bottomnav__ic">
          <Icon name={it.icon} strokeWidth={on ? 2.4 : 2} />
        </span>
        <span>{it.label}</span>
      </Link>
    );
  };

  return (
    <nav className="bottomnav" aria-label="하단 메뉴">
      <div className="bottomnav__in">
        {items.map(link)}
      </div>
    </nav>
  );
}
