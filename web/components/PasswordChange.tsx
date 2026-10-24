"use client";

import { useState, type FormEvent } from "react";
import { PASSWORD_MIN } from "@/lib/phone";

/** 내 정보 — 비밀번호 변경. 버튼을 누르면 폼이 펼쳐집니다. */
export default function PasswordChange() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const current = String(f.get("current") ?? "");
    const next = String(f.get("next") ?? "");
    if (next.length < PASSWORD_MIN) return setErr(`새 비밀번호는 ${PASSWORD_MIN}자 이상으로 해주세요.`);
    if (next !== String(f.get("confirm") ?? "")) return setErr("새 비밀번호가 서로 달라요.");
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      if (res.ok) {
        setDone(true);
        setOpen(false);
      } else {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setErr(j?.message ?? "비밀번호를 바꾸지 못했어요.");
      }
    } catch {
      setErr("연결이 불안정해요. 잠시 뒤 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <>
        {done && <p className="sec-desc">비밀번호를 바꿨어요. 다른 기기에서는 새 비밀번호로 다시 로그인해 주세요.</p>}
        <button type="button" className="btn btn--soft btn--block" onClick={() => { setOpen(true); setDone(false); }}>
          비밀번호 변경
        </button>
      </>
    );
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <label className="field">
        <span className="field__label">현재 비밀번호</span>
        <input className="input" name="current" type="password" autoComplete="current-password" required autoFocus />
      </label>
      <label className="field">
        <span className="field__label">새 비밀번호</span>
        <input className="input" name="next" type="password" autoComplete="new-password" placeholder={`${PASSWORD_MIN}자 이상`} required />
      </label>
      <label className="field">
        <span className="field__label">새 비밀번호 확인</span>
        <input className="input" name="confirm" type="password" autoComplete="new-password" required />
      </label>
      {err && <p className="form-err" role="alert">{err}</p>}
      <button type="submit" className="btn btn--block" disabled={busy}>
        {busy ? "바꾸는 중…" : "비밀번호 바꾸기"}
      </button>
      <button type="button" className="btn btn--soft btn--block" onClick={() => { setOpen(false); setErr(null); }} disabled={busy}>
        취소
      </button>
    </form>
  );
}
