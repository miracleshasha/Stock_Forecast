"use client";

import { useState } from "react";
import { resetFavorites } from "@/lib/favorites";
import { formatPhone, isValidPhone, normalizePhone } from "@/lib/phone";

/** 전화번호만 입력. 처음 쓰는 번호면 서버가 계정을 만들어 줍니다(가입 절차 없음). */
export default function AuthForm({ next }: { next: string }) {
  const [phone, setPhone] = useState("");
  // 비공개 화면 권한이 있는 계정만 서버가 needPassword 를 돌려줍니다
  const [needPw, setNeedPw] = useState(false);
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidPhone(phone)) return setError("휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)");
    if (needPw && !pw) return setError("비밀번호를 입력해 주세요.");

    setBusy(true);
    let leaving = false;
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(phone), ...(needPw ? { password: pw } : {}) }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string; needPassword?: boolean } | null;
        if (body?.needPassword) setNeedPw(true);
        setError(body?.message ?? "잠시 뒤 다시 시도해 주세요.");
        return;
      }
      resetFavorites(); // 이제 계정 모드 — 다음 화면에서 브라우저 즐겨찾기를 계정으로 합칩니다
      // 전체 새로고침으로 이동합니다. router.replace + router.refresh 를 연달아 쓰면
      // refresh 가 이동을 덮어써 로그인 화면이 다시 그려지는 경우가 있었습니다(2026-09-27 첫 가입 때).
      // 새로 받은 로그인 쿠키로 상단 메뉴(레이아웃)까지 확실히 다시 그리려는 목적도 있습니다.
      leaving = true; // 이동이 끝날 때까지 버튼을 잠가 두 번 요청되는 것을 막습니다
      window.location.replace(next);
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <section className="card auth">
      <h1 className="page-hd__t">즐겨찾기 열기</h1>
      <p className="sec-desc">
        휴대폰 번호만 입력하면 돼요. 처음이면 바로 만들어지고, 다음부터는 같은 번호로 들어오면
        즐겨찾기가 그대로 있어요.
      </p>

      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">휴대폰 번호</span>
          <input
            className="input num"
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            placeholder="010-1234-5678"
            value={phone}
            onChange={(e) => {
              setPhone(formatPhone(e.target.value));
              setNeedPw(false);
              setPw("");
            }}
            required
          />
        </label>
        {needPw && (
          <label className="field">
            <span className="field__label">비밀번호</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              maxLength={72}
              autoFocus
              required
            />
          </label>
        )}

        {error && (
          <p className="form-err" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="btn btn--block" disabled={busy}>
          {busy ? <span className="spinner spinner--light" aria-label="처리 중" /> : "들어가기"}
        </button>
      </form>

      <p className="caption" style={{ textAlign: "center" }}>
        문자 인증은 하지 않아요. 이 기기에서는 다음부터 자동으로 들어가져요.
      </p>
    </section>
  );
}
