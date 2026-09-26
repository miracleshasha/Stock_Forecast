"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@/lib/types";
import { MARKET_LABEL, changeTone, formatPct } from "@/lib/format";
import Icon from "./Icon";
import { useNavProgress } from "./NavProgress";

const SUGGESTIONS = ["삼성전자", "SK하이닉스", "NVDA", "AAPL", "에코프로비엠"];

export default function SearchBox({
  autoFocus = false,
  registerInput,
  onPick,
}: {
  autoFocus?: boolean;
  /** 입력창 요소를 받아 둘 곳. 검색 시트가 탭한 순간 바로 포커스를 주는 데 씁니다. */
  registerInput?: (el: HTMLInputElement | null) => void;
  /** 종목을 골랐을 때(검색 시트 닫기용) */
  onPick?: () => void;
}) {
  const router = useRouter();
  const { start } = useNavProgress();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [navigating, setNavigating] = useState(false);
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
    setOpen(true);
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
    onPick?.();
    setNavigating(true);
    start();
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
      <label className={`search${open && results.length ? " search--focus" : ""}`}>
        {loading || navigating ? (
          <span className="spinner" aria-label="불러오는 중" />
        ) : (
          <Icon name="search" size={22} />
        )}
        <input
          ref={(el) => {
            inputRef.current = el;
            registerInput?.(el);
          }}
          type="search"
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
          enterKeyHint="search"
        />
      </label>

      {open && q.trim().length >= 2 && (
        <div className="drop" role="listbox" aria-label="검색 결과">
          {loading && (
            <div className="drop__row drop__hint">
              <span className="spinner" style={{ marginRight: 8 }} /> 검색 중…
            </div>
          )}
          {results.map((r, i) => (
            <div
              key={r.ticker}
              className={`drop__row${i === active ? " drop__row--on" : ""}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(r.ticker)}
            >
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span className="drop__name">{r.name}</span>
                <span className="drop__tick">
                  {r.ticker} · {MARKET_LABEL[r.market] ?? r.market}
                </span>
              </span>
              <span className={`drop__px num ${changeTone(r.changePct)}`}>
                <span style={{ color: "var(--ink)" }}>
                  {r.price != null ? r.price.toLocaleString() : "—"}
                </span>
                <br />
                <small>{formatPct(r.changePct)}</small>
              </span>
            </div>
          ))}
          {!loading && results.length === 0 && (
            <div className="drop__empty">
              아직 지원하지 않는 종목이에요. 지원 종목은 계속 늘려갈게요.
            </div>
          )}
        </div>
      )}

      {!q && (
        <div className="chips">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setQ(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
