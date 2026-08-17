"use client";

import { useEffect, useRef, useState } from "react";
import { GLOSSARY } from "@/lib/glossary";

/** 지표 용어 + 물음표. 클릭/탭으로 설명 팝오버, 데스크톱은 호버로도 표시. */
export default function Term({ label }: { label: string }) {
  const def = GLOSSARY[label];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!def) return <span className="row__k">{label}</span>;

  return (
    <span className="term" ref={ref}>
      <button
        type="button"
        className="term__btn"
        aria-expanded={open}
        aria-label={`${label} 설명`}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
        <span className="term__q" aria-hidden>?</span>
      </button>
      <span className={`term__pop${open ? " term__pop--open" : ""}`} role="tooltip">
        {def}
      </span>
    </span>
  );
}
