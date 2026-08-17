"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";

type NavCtx = { start: () => void };
const Ctx = createContext<NavCtx>({ start: () => {} });
export const useNavProgress = () => useContext(Ctx);

/** 상단 내비게이션 진행 바. router.push 직전에 start()를 호출하면
 *  경로가 바뀔 때(전환 커밋) 자동으로 100%까지 채우고 사라집니다. */
export default function NavProgress({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const pathname = usePathname();
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const safety = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedPath = useRef<string | null>(null);

  const clear = () => {
    if (tick.current) {
      clearInterval(tick.current);
      tick.current = null;
    }
    if (safety.current) {
      clearTimeout(safety.current);
      safety.current = null;
    }
  };

  const start = useCallback(() => {
    startedPath.current = pathname;
    setVisible(true);
    setWidth(8);
    clear();
    tick.current = setInterval(() => {
      setWidth((w) => (w < 90 ? w + (90 - w) * 0.12 : w));
    }, 200);
    // 안전장치: 전환이 없거나(같은 경로) 지연되면 강제 종료
    safety.current = setTimeout(() => {
      clear();
      setVisible(false);
      setWidth(0);
      startedPath.current = null;
    }, 8000);
  }, [pathname]);

  // 경로가 바뀌면(내비게이션 커밋) 완료 처리
  useEffect(() => {
    if (startedPath.current !== null && startedPath.current !== pathname) {
      clear();
      setWidth(100);
      const t = setTimeout(() => {
        setVisible(false);
        setWidth(0);
        startedPath.current = null;
      }, 350);
      return () => clearTimeout(t);
    }
  }, [pathname]);

  useEffect(() => () => clear(), []);

  return (
    <Ctx.Provider value={{ start }}>
      <div
        className="navprogress"
        style={{ width: `${width}%`, opacity: visible ? 1 : 0 }}
        aria-hidden
      />
      {children}
    </Ctx.Provider>
  );
}
