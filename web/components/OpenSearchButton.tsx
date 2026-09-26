"use client";

import { useSearchSheet } from "./SearchSheet";

export default function OpenSearchButton({ children, className = "btn" }: { children: React.ReactNode; className?: string }) {
  const { openSearch } = useSearchSheet();
  return (
    <button type="button" className={className} onClick={openSearch}>
      {children}
    </button>
  );
}
