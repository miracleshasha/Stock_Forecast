"use client";

// ============================================================
// 전체 화면 검색 시트 (모바일 하단 탭 "검색")
//
// 모바일 브라우저(특히 iOS)는 사용자가 누른 그 이벤트 안에서 focus() 를
// 불러야만 키보드를 올려줍니다. 그래서 탭 핸들러에서 flushSync 로 시트를
// 즉시 그린 다음, 같은 호출 흐름 안에서 입력창에 포커스를 줍니다.
// ============================================================

import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import Icon from "./Icon";
import SearchBox from "./SearchBox";

type Ctx = { openSearch: () => void; searchOpen: boolean };
const SearchCtx = createContext<Ctx>({ openSearch: () => {}, searchOpen: false });
export const useSearchSheet = () => useContext(SearchCtx);

export default function SearchSheetProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  // 열었던 경로를 기억해 두고, 검색 결과로 이동해 경로가 바뀌면 자동으로 닫힌 것으로 봅니다
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === path;
  const inputEl = useRef<HTMLInputElement | null>(null);

  const openSearch = useCallback(() => {
    flushSync(() => setOpenedAt(path));
    inputEl.current?.focus();
  }, [path]);
  const close = useCallback(() => setOpenedAt(null), []);

  // 열려 있는 동안 뒤 페이지 스크롤 잠금 + Esc 로 닫기
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <SearchCtx.Provider value={{ openSearch, searchOpen: open }}>
      {children}
      {open && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="종목 검색">
          <div className="sheet__hd">
            <span className="sheet__t">검색</span>
            <button type="button" className="iconbtn" onClick={close} aria-label="검색 닫기">
              <Icon name="close" />
            </button>
          </div>
          <div className="sheet__body">
            <SearchBox
              registerInput={(el) => {
                inputEl.current = el;
              }}
              onPick={close}
            />
          </div>
        </div>
      )}
    </SearchCtx.Provider>
  );
}
