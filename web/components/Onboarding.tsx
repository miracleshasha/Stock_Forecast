"use client";

// ============================================================
// 처음 온 사람용 안내
// - 홈: 하단 시트 3~4장 (한 번만, 언제든 건너뛰기). 휴대폰이면 마지막에 홈 화면 추가 안내
// - 종목 화면: 공유 링크로 바로 들어온 사람에게 점수 읽는 법 한 줄
// 본 기록은 이 브라우저에만 남깁니다(카톡 링크도 기본 브라우저로 열리므로 유지됨).
// 전화번호를 넣은 기존 사용자(known)에게는 띄우지 않고, 내 정보의 "다시 보기"(/?guide=1)로만 엽니다.
// ============================================================

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import Icon from "./Icon";
import SignalGauge from "./SignalGauge";

const SEEN_KEY = "sd.guideSeen";

// 본 기록을 바깥 저장소로 다룹니다. 서버에서는 "이미 봄"으로 그려서 안내가 깜빡이지 않게 합니다
const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function readSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeen() {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {}
  listeners.forEach((fn) => fn());
}
const useSeen = () => useSyncExternalStore(subscribe, readSeen, () => true);

// ---------- 홈 화면에 추가 ----------
// 기기 종류는 브라우저에서만 알 수 있어 서버에서는 "기타"로 그립니다
type Device = "ios" | "android" | "other";
type InstallEvent = Event & { prompt: () => Promise<void> };

let installEvt: InstallEvent | null = null;
const installListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  // 안드로이드 크롬은 설치 가능할 때 이 이벤트를 한 번 줍니다 — 잡아 뒀다가 버튼으로 띄웁니다
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installEvt = e as InstallEvent;
    installListeners.forEach((fn) => fn());
  });
}
const noop = () => () => {};
function readDevice(): Device {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}
// 이미 홈 화면 아이콘으로 열었으면 안내할 필요가 없습니다
const readStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const useDevice = () => useSyncExternalStore(noop, readDevice, () => "other" as Device);
const useStandalone = () => useSyncExternalStore(noop, readStandalone, () => false);
const useInstallEvt = () =>
  useSyncExternalStore(
    (fn) => {
      installListeners.add(fn);
      return () => installListeners.delete(fn);
    },
    () => installEvt,
    () => null,
  );

function AddToHome({ device }: { device: Device }) {
  const evt = useInstallEvt();
  if (device === "android" && evt) {
    return (
      <button
        type="button"
        className="btn btn--soft btn--block guide__install"
        onClick={async () => {
          await evt.prompt();
          installEvt = null;
          installListeners.forEach((fn) => fn());
        }}
      >
        홈 화면에 바로 추가
      </button>
    );
  }
  const steps =
    device === "ios"
      ? [
          <>
            화면 아래(또는 위)의 <b>공유</b> 버튼<Icon name="share" size={16} />을 눌러요
          </>,
          <>
            목록을 내려 <b>홈 화면에 추가</b>를 눌러요
          </>,
          <>
            오른쪽 위 <b>추가</b>를 누르면 끝이에요
          </>,
        ]
      : [
          <>
            오른쪽 위 <b>메뉴(⋮)</b>를 눌러요
          </>,
          <>
            <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요
          </>,
          <>
            <b>추가</b>(설치)를 누르면 끝이에요
          </>,
        ];
  return (
    <ol className="guide__steps">
      {steps.map((x, i) => (
        <li key={i}>
          <span className="guide__n num">{i + 1}</span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

type Step = { key: "intro" | "score" | "free" | "home"; t: string; d: string };
const STEPS: Step[] = [
  {
    key: "intro",
    t: "차트 흐름을 점수 하나로",
    d: "종목을 검색하면 추세·모멘텀·밴드·거래량을 함께 보고 지금 차트가 어느 쪽을 향하는지 요약해 드려요.",
  },
  {
    key: "score",
    t: "점수는 −100 ~ +100",
    d: "높을수록 상승 흐름, 낮을수록 하락 흐름이에요. 빨강은 상승, 파랑은 하락이에요.",
  },
  {
    key: "free",
    t: "가입 없이 바로 쓰세요",
    d: "검색과 판정은 누구나 볼 수 있어요. 즐겨찾기만 휴대폰 번호를 넣으면 돼요.",
  },
  {
    key: "home",
    t: "홈 화면에 두고 앱처럼",
    d: "휴대폰 바탕화면에 아이콘을 만들어 두면 매일 한 번에 열 수 있어요.",
  },
];

export function HomeGuide({ known }: { known: boolean }) {
  const params = useSearchParams();
  const forced = params.get("guide") === "1";
  // "다시 보기"로 들어올 때마다 새로 그려서 닫힘·몇 번째 장 상태를 처음부터 시작합니다
  return <GuideSheet key={forced ? "again" : "first"} known={known} forced={forced} />;
}

function GuideSheet({ known, forced }: { known: boolean; forced: boolean }) {
  const router = useRouter();
  const seen = useSeen();
  const device = useDevice();
  const standalone = useStandalone();
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);
  // 홈 화면 아이콘으로 연 앱은 사파리와 저장 공간이 따로라, 처음 연 것처럼 보여도 자동으로 띄우지 않습니다
  const open = !closed && (forced || (!known && !seen && !standalone));
  // 휴대폰 브라우저에서만 홈 화면 추가 안내를 넣습니다
  const steps = STEPS.filter((x) => x.key !== "home" || (device !== "other" && !standalone));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close() {
    markSeen();
    setClosed(true);
    if (forced) router.replace("/", { scroll: false });
  }

  if (!open) return null;
  const s = steps[Math.min(step, steps.length - 1)];
  const last = step >= steps.length - 1;

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="주가예보 사용법">
      <div className="guide__dim" onClick={close} />
      <div className="guide__panel">
        <div className="guide__hd">
          <span className="guide__dots" aria-label={`${steps.length}장 중 ${step + 1}장`}>
            {steps.map((x, i) => (
              <span key={x.key} className={`guide__dot${i === step ? " guide__dot--on" : ""}`} />
            ))}
          </span>
          {!last && (
            <button type="button" className="guide__skip" onClick={close}>
              건너뛰기
            </button>
          )}
        </div>

        <h2 className="guide__t">{s.t}</h2>
        <p className="guide__d">{s.d}</p>

        {s.key === "score" && (
          <div className="guide__demo">
            <SignalGauge score={42} />
          </div>
        )}
        {s.key === "free" && (
          <p className="guide__disc">
            현재 차트 상태를 요약한 정보예요. 앞으로의 수익을 보장하지 않으며, 투자 판단의 책임은 본인에게 있어요.
          </p>
        )}
        {s.key === "home" && <AddToHome device={device} />}

        <button
          type="button"
          className="btn btn--block"
          onClick={() => (last ? close() : setStep(step + 1))}
        >
          {last ? "시작하기" : "다음"}
        </button>
      </div>
    </div>
  );
}

/** 공유 링크로 종목 화면에 바로 들어온 사람에게 점수 읽는 법 한 줄 */
export function StockHint({ known }: { known: boolean }) {
  const seen = useSeen();
  if (known || seen) return null;
  return (
    <p className="notice guide-hint">
      <Icon name="info" size={18} />
      <span>
        아래 점수는 <b>−100 ~ +100</b>이에요. 높을수록 상승 흐름, 낮을수록 하락 흐름이에요.{" "}
        <Link href="/?guide=1" className="linkbtn">
          사용법 보기
        </Link>
      </span>
      <button
        type="button"
        className="iconbtn guide-hint__x"
        aria-label="안내 닫기"
        onClick={markSeen}
      >
        <Icon name="close" size={18} />
      </button>
    </p>
  );
}
