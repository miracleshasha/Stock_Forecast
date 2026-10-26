"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon, { type IconName } from "./Icon";

type Item = { href: string; label: string; icon: IconName; match: (p: string) => boolean };

/** 모바일 하단 탭. 768px 이상에서는 CSS로 숨기고 상단 메뉴를 씁니다. */
export default function BottomNav({ who }: { who: string | null }) {
  const path = usePathname();
  // 번호 입력 화면에서도 하단 탭을 보여 줘서 바로 다른 화면으로 갈 수 있게 합니다

  const items: (Item | null)[] = [
    { href: "/", label: "홈", icon: "home", match: (p) => p === "/" },
    { href: "/news", label: "뉴스", icon: "news", match: (p) => p === "/news" },
    { href: "/favorites", label: "즐겨찾기", icon: "star", match: (p) => p === "/favorites" || p === "/login" },
    who
      ? { href: "/account", label: "내 정보", icon: "user", match: (p) => p === "/account" }
      : null, // 번호를 넣기 전엔 내 정보가 없음 — 즐겨찾기를 열 때 번호를 받습니다
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
        {items.filter((it): it is Item => it != null).map(link)}
      </div>
    </nav>
  );
}
