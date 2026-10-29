/** 선 아이콘 (24px 격자). 색은 currentColor 를 따릅니다. */
const PATHS = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />,
  home: <path d="M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  back: <path d="M15 5l-7 7 7 7" />,
  chev: <path d="M9 5l7 7-7 7" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  /** 사파리 아래 바의 더보기 단추 — 점 세 개가 든 둥근 사각형 */
  more: (
    <>
      <rect x="2.5" y="4.5" width="19" height="15" rx="5" />
      <path d="M7.5 12h.01M12 12h.01M16.5 12h.01" strokeWidth="2.8" />
    </>
  ),
  share: (
    <>
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M7 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </>
  ),
  news: (
    <>
      <path d="M5 4.5h11a1 1 0 0 1 1 1V19a1.5 1.5 0 0 0 1.5 1.5H6.5A2.5 2.5 0 0 1 4 18V5.5a1 1 0 0 1 1-1z" />
      <path d="M17 9h2a1 1 0 0 1 1 1v9a1.5 1.5 0 0 1-3 0" />
      <path d="M7.5 8.5h6M7.5 12h6M7.5 15.5h4" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5c1.2-3.6 4.2-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 24,
  filled = false,
  strokeWidth = 2,
}: {
  name: IconName;
  size?: number;
  filled?: boolean;
  strokeWidth?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {PATHS[name]}
    </svg>
  );
}
