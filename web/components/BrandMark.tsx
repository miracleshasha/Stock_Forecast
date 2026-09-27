/** 시그널데스크 로고 마크 — 하락(블루) 캔들 뒤로 상승(레드) 캔들이 올라서는 모양. app/icon.svg와 같은 도형. */
export default function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand__mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="9" fill="#191F28" />
      <path d="M11 7.5v17" stroke="#6EA8FF" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7.5" y="11" width="7" height="10" rx="2" fill="#3D86F5" />
      <path d="M21 5.5v21" stroke="#FF6B78" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="17.5" y="8" width="7" height="14" rx="2" fill="#F04452" />
    </svg>
  );
}
