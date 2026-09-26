"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetFavorites } from "@/lib/favorites";

export default function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      resetFavorites();
      router.replace("/login?mode=login");
      router.refresh();
    }
  }

  return (
    <button type="button" className="btn btn--soft btn--block" onClick={logout} disabled={busy}>
      {busy ? "로그아웃 중…" : "로그아웃"}
    </button>
  );
}
