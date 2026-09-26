"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetFavorites } from "@/lib/favorites";
import { PASSWORD_MIN, formatPhone, isValidPhone, normalizePhone } from "@/lib/phone";

type Mode = "login" | "signup";

export default function AuthForm({ initialMode, next }: { initialMode: Mode; next: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [phone, setPhone] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const signup = mode === "signup";

  function switchMode(m: Mode) {
    setMode(m);
    setError(null);
    setPw("");
    setPw2("");
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidPhone(phone)) return setError("휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)");
    if (pw.length < PASSWORD_MIN) return setError(`비밀번호는 ${PASSWORD_MIN}자 이상으로 해주세요.`);
    if (signup && pw !== pw2) return setError("비밀번호가 서로 달라요.");

    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${signup ? "signup" : "login"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: normalizePhone(phone), password: pw }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(body?.message ?? "잠시 뒤 다시 시도해 주세요.");
        return;
      }
      resetFavorites(); // 이제 계정 모드 — 다음 화면에서 브라우저 즐겨찾기를 계정으로 합칩니다
      router.replace(next);
      router.refresh();
    } catch {
      setError("네트워크 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card auth">
      <h1 className="page-hd__t">{signup ? "회원가입" : "로그인"}</h1>
      <p className="sec-desc">
        {signup
          ? "휴대폰 번호를 아이디로 써요. 문자 인증은 하지 않아요."
          : "휴대폰 번호와 비밀번호로 로그인해요."}
      </p>

      <div className="seg" role="tablist" aria-label="로그인 또는 회원가입">
        <button
          type="button"
          role="tab"
          aria-selected={!signup}
          className={`seg__btn${!signup ? " seg__btn--on" : ""}`}
          onClick={() => switchMode("login")}
        >
          로그인
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={signup}
          className={`seg__btn${signup ? " seg__btn--on" : ""}`}
          onClick={() => switchMode("signup")}
        >
          회원가입
        </button>
      </div>

      <form className="form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">휴대폰 번호</span>
          <input
            className="input num"
            type="tel"
            inputMode="numeric"
            autoComplete="username"
            placeholder="010-1234-5678"
            value={phone}
            onChange={(e) => setPhone(formatPhone(e.target.value))}
            required
          />
        </label>
        <label className="field">
          <span className="field__label">비밀번호</span>
          <input
            className="input"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            placeholder={`${PASSWORD_MIN}자 이상`}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            minLength={PASSWORD_MIN}
            maxLength={72}
            required
          />
        </label>
        {signup && (
          <label className="field">
            <span className="field__label">비밀번호 확인</span>
            <input
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="한 번 더 입력"
              value={pw2}
              onChange={(e) => setPw2(e.target.value)}
              maxLength={72}
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
          {busy ? <span className="spinner spinner--light" aria-label="처리 중" /> : signup ? "가입하고 시작하기" : "로그인"}
        </button>
      </form>

      {signup ? (
        <p className="caption" style={{ textAlign: "center" }}>
          비밀번호를 잊으면 문자·메일로 찾을 수 없어요. 꼭 기억해 두세요.
        </p>
      ) : (
        <p className="caption" style={{ textAlign: "center" }}>
          처음이신가요?{" "}
          <button type="button" className="linkbtn" onClick={() => switchMode("signup")}>
            회원가입
          </button>
        </p>
      )}
    </section>
  );
}
