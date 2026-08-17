"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";
import { changeTone, formatPct } from "@/lib/format";

const SUGGESTIONS = ["삼성전자", "SK하이닉스", "NVDA", "AAPL", "에코프로비엠"];

export default function SearchBox({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [composing, setComposing] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 2글자 이상 + 300ms 디바운스, 한글 조합 중에는 호출 안 함
  useEffect(() => {
    if (composing) return;
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
        const data = (await res.json()) as SearchResult[];
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
        setActive(-1);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(id);
  }, [q, composing]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(ticker: string) {
    setOpen(false);
    router.push(`/stock/${ticker}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) {
      if (e.key === "Enter" && results[0]) go(results[0].ticker);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = active >= 0 ? results[active] : results[0];
      if (pick) go(pick.ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="searchbox" ref={boxRef}>
      <div className={`search${open && results.length ? " search--focus" : ""}`}>
        <svg className="icon-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="7" />
          <path d="M16.5 16.5 21 21" />
        </svg>
        <input
          ref={inputRef}
          autoFocus={autoFocus}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            setQ((e.target as HTMLInputElement).value);
          }}
          placeholder="종목명, 티커, 종목코드로 검색"
          aria-label="종목 검색"
          spellCheck={false}
        />
      </div>

      {open && q.trim().length >= 2 && (
        <div className="drop" role="listbox">
          {results.map((r, i) => (
            <div
              key={r.ticker}
              className={`drop__row${i === active ? " drop__row--on" : ""}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.ticker)}
            >
              <span className="badge">{r.market}</span>
              <span className="drop__name">{r.name}</span>
              <span className="drop__tick">{r.ticker}</span>
              <span className={`drop__px ${changeTone(r.changePct)}`}>
                {r.price != null ? r.price.toLocaleString() : "—"}
                <br />
                <small>{formatPct(r.changePct)}</small>
              </span>
            </div>
          ))}
          {!loading && results.length === 0 && (
            <div className="drop__empty">
              현재 지원하지 않는 종목입니다. 소규모 유니버스로 시작해 확장 예정입니다.
            </div>
          )}
          {results.length > 0 && (
            <div className="drop__row drop__hint">↑↓ 이동 · Enter 선택 · Esc 닫기</div>
          )}
        </div>
      )}

      {!q && (
        <div className="suggest-chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="chip" onClick={() => setQ(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
