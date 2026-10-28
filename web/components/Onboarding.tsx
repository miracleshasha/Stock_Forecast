"use client";

// ============================================================
// 사용법 안내
// - 홈: 하단 시트 5~6장. 들어올 때마다 보여 주고, "다시 보지 않기"를 누르면 더는 안 띄웁니다.
//   그냥 닫으면 이번 방문 동안만 숨기고 다음에 열 때 다시 보여 줍니다.
//   휴대폰이면 마지막에 홈 화면 추가 안내
// - 종목 화면: 공유 링크로 바로 들어온 사람에게 점수 읽는 법 한 줄
// 내 정보의 "사용법 다시 보기"(/?guide=1)로는 언제든 엽니다.
// ============================================================

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { OutlookHorizon } from "@/lib/types";
import Icon from "./Icon";
import { OutlookRow } from "./OutlookCard";
import SignalGauge from "./SignalGauge";

// ---------- 본 기록 ----------
// 다시 보지 않기 = 이 브라우저에 계속, 그냥 닫기 = 이번 방문(탭)에만
const NEVER_KEY = "sd.guideNever";
const CLOSED_KEY = "sd.guideClosed";
const HINT_KEY = "sd.hintClosed";

const listeners = new Set<() => void>();
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function read(store: "local" | "session", key: string): boolean {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(store: "local" | "session", key: string) {
  try {
    (store === "local" ? window.localStorage : window.sessionStorage).setItem(key, "1");
  } catch {}
  listeners.forEach((fn) => fn());
}
// 서버에서는 "숨김"으로 그려서 안내가 깜빡이지 않게 합니다
const useHidden = (pick: () => boolean) => useSyncExternalStore(subscribe, pick, () => true);
const guideHidden = () => read("local", NEVER_KEY) || read("session", CLOSED_KEY);
const hintHidden = () => read("local", NEVER_KEY) || read("session", HINT_KEY);

/** 닫는 탭이 아래 검색창에 닿아 키보드가 올라오는 것을 잠깐 막습니다 */
function guardFocus(ms: number) {
  const blurIfInput = (el: Element | null) => {
    if (el instanceof HTMLInputElement && !el.closest(".guide")) el.blur();
  };
  const onFocus = (e: FocusEvent) => blurIfInput(e.target as Element);
  document.addEventListener("focusin", onFocus);
  if (ms <= 0) return () => document.removeEventListener("focusin", onFocus);
  // 포커스 이벤트가 늦거나 안 오는 브라우저도 있어 닫은 직후 몇 번 더 확인합니다
  const timers = [0, 100, 300, ms].map((t) => setTimeout(() => blurIfInput(document.activeElement), t));
  const stop = setTimeout(() => document.removeEventListener("focusin", onFocus), ms);
  return () => {
    timers.forEach(clearTimeout);
    clearTimeout(stop);
    document.removeEventListener("focusin", onFocus);
  };
}

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
// 이미 홈 화면 아이콘으로 열었으면 추가 안내는 필요 없습니다
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

function NumList({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="guide__steps">
      {items.map((x, i) => (
        <li key={i}>
          <span className="guide__n num">{i + 1}</span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

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
  return (
    <NumList
      items={
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
            ]
      }
    />
  );
}

// ---------- 안내 장마다 보여 주는 예시 화면 ----------
const ZONES: [string, string, string][] = [
  ["+40 이상", "상승 흐름", "up"],
  ["+15 ~ +39", "약한 상승 흐름", "up"],
  ["−14 ~ +14", "방향 탐색 중", ""],
  ["−39 ~ −15", "약한 하락 흐름", "down"],
  ["−40 이하", "하락 흐름", "down"],
];

const GROUPS: [string, number, string][] = [
  ["추세", 40, "가격이 오르는 길인지 내리는 길인지"],
  ["모멘텀", 20, "오르거나 내리는 힘이 붙었는지"],
  ["밴드 위치", 20, "평소 움직이는 폭 안에서 어디쯤인지"],
  ["거래량", 20, "사고파는 힘이 어느 쪽으로 몰리는지"],
];

// 예시 숫자 — 실제 종목 값이 아닙니다
const SAMPLE_OUTLOOK: OutlookHorizon = {
  h: 5,
  p: 0.53,
  base: 0.52,
  lo: -0.06,
  mid: 0.004,
  hi: 0.065,
  drivers: [],
  enabled: true, // 괄호 속 "평소 비율"까지 보이게
  wf: null,
  rangeWf: null,
};

type StepKey = "intro" | "score" | "why" | "outlook" | "free" | "home";
type Step = { key: StepKey; t: string; d: string };
const STEPS: Step[] = [
  {
    key: "intro",
    t: "검색 한 번이면 차트 흐름이 보여요",
    d: "종목명·티커·종목코드로 국내·미국 종목을 찾아보세요. 매 거래일 종가로 새로 판정해요. 종목 화면에서는 이런 걸 볼 수 있어요.",
  },
  {
    key: "score",
    t: "점수는 −100 ~ +100",
    d: "여러 기술 지표를 합쳐 지금 차트가 어느 쪽을 향하는지 점수 하나로 보여드려요. 빨강은 상승, 파랑은 하락이에요.",
  },
  {
    key: "why",
    t: "왜 그런 점수인지도 보여드려요",
    d: "점수는 네 가지 지표 묶음을 비중대로 더한 값이에요. 종목 화면의 '왜 이렇게 봤나요'에서 묶음별 점수와 설명을 볼 수 있어요.",
  },
  {
    key: "outlook",
    t: "N일 뒤 전망",
    d: "5·10·20거래일 뒤에 오를 확률과, 80% 확률로 들어올 수익률 범위를 보여드려요. 아래는 예시 화면이에요.",
  },
  {
    key: "free",
    t: "가입 없이 바로, 즐겨찾기는 번호만",
    d: "검색·판정·전망은 누구나 볼 수 있어요. 종목 화면의 별표를 누르고 휴대폰 번호만 넣으면 즐겨찾기가 저장되고, 홈 맨 위에서 관심 종목 소식을 모아 볼 수 있어요.",
  },
  {
    key: "home",
    t: "홈 화면에 두고 앱처럼",
    d: "휴대폰 바탕화면에 아이콘을 만들어 두면 매일 한 번에 열 수 있어요.",
  },
];

function StepBody({ k, device }: { k: StepKey; device: Device }) {
  switch (k) {
    case "intro":
      return (
        <NumList
          items={[
            <>
              <b>지금 차트 흐름</b> — 점수와 판정 한 줄 요약
            </>,
            <>
              <b>N일 뒤 전망</b> — 오를 확률과 움직일 범위
            </>,
            <>
              <b>왜 이렇게 봤나요</b> — 지표별 근거
            </>,
          ]}
        />
      );
    case "score":
      return (
        <div className="guide__demo">
          <div className="guide__verdict">
            <span className="verdict__zone up">약한 상승 흐름</span>
            <span className="verdict__score num">+24점</span>
          </div>
          <SignalGauge score={24} />
          <ul className="guide__zones">
            {ZONES.map(([range, label, tone]) => (
              <li key={label}>
                <span className="num">{range}</span>
                <b className={tone}>{label}</b>
              </li>
            ))}
          </ul>
        </div>
      );
    case "why":
      return (
        <ul className="guide__demo guide__groups">
          {GROUPS.map(([name, w, desc]) => (
            <li key={name}>
              <span className="guide__gname">
                {name} <span className="why__w">비중 {w}%</span>
              </span>
              <span className="guide__gdesc">{desc}</span>
            </li>
          ))}
        </ul>
      );
    case "outlook":
      return (
        <>
          <div className="guide__demo guide__outlook">
            <ul className="outlook">
              <OutlookRow o={SAMPLE_OUTLOOK} scale={0.07} close={null} currency="KRW" />
            </ul>
          </div>
          <ul className="guide__legend">
            <li>
              <b>오를 확률</b> 괄호 안은 같은 시장 종목이 그 기간 뒤 평소 오른 비율이에요
            </li>
            <li>
              <b>막대</b> 80% 확률로 들어올 수익률 범위예요. 빨강은 오르는 쪽, 파랑은 내리는 쪽
            </li>
            <li>
              <b>가운데 점</b> 범위의 중간값이에요
            </li>
          </ul>
        </>
      );
    case "free":
      return (
        <p className="guide__disc">
          현재 차트 상태를 요약한 정보예요. 앞으로의 수익을 보장하지 않으며, 투자 판단의 책임은 본인에게 있어요.
        </p>
      );
    case "home":
      return <AddToHome device={device} />;
  }
}

export function HomeGuide() {
  const params = useSearchParams();
  const forced = params.get("guide") === "1";
  // "다시 보기"로 들어올 때마다 새로 그려서 닫힘·몇 번째 장 상태를 처음부터 시작합니다
  return <GuideSheet key={forced ? "again" : "first"} forced={forced} />;
}

function GuideSheet({ forced }: { forced: boolean }) {
  const router = useRouter();
  const hidden = useHidden(guideHidden);
  const device = useDevice();
  const standalone = useStandalone();
  const [closed, setClosed] = useState(false);
  const [step, setStep] = useState(0);
  const open = !closed && (forced || !hidden);
  // 휴대폰 브라우저에서만 홈 화면 추가 안내를 넣습니다
  const steps = STEPS.filter((x) => x.key !== "home" || (device !== "other" && !standalone));

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // 안내가 떠 있는 동안 뒤 검색창에 포커스가 가서 키보드가 올라오지 않게
    (document.activeElement as HTMLElement | null)?.blur?.();
    const unguard = guardFocus(0);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      unguard();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function close(never: boolean) {
    write(never ? "local" : "session", never ? NEVER_KEY : CLOSED_KEY);
    guardFocus(600);
    setClosed(true);
    if (forced) router.replace("/", { scroll: false });
  }

  if (!open) return null;
  const i = Math.min(step, steps.length - 1);
  const s = steps[i];
  const last = i === steps.length - 1;

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="주가예보 사용법">
      <div className="guide__dim" onClick={() => close(false)} />
      <div className="guide__panel">
        <div className="guide__hd">
          <span className="guide__dots" aria-label={`${steps.length}장 중 ${i + 1}장`}>
            {steps.map((x, n) => (
              <span key={x.key} className={`guide__dot${n === i ? " guide__dot--on" : ""}`} />
            ))}
          </span>
          <button type="button" className="iconbtn guide__x" aria-label="안내 닫기" onClick={() => close(false)}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="guide__body">
          <h2 className="guide__t">{s.t}</h2>
          <p className="guide__d">{s.d}</p>
          <StepBody k={s.key} device={device} />
        </div>

        <div className="guide__ft">
          {i > 0 && (
            <button type="button" className="btn btn--soft guide__prev" onClick={() => setStep(i - 1)}>
              이전
            </button>
          )}
          <button type="button" className="btn guide__next" onClick={() => (last ? close(false) : setStep(i + 1))}>
            {last ? "시작하기" : "다음"}
          </button>
        </div>
        <button type="button" className="guide__never" onClick={() => close(true)}>
          다시 보지 않기
        </button>
      </div>
    </div>
  );
}

/** 공유 링크로 종목 화면에 바로 들어온 사람에게 점수 읽는 법 한 줄 */
export function StockHint() {
  const hidden = useHidden(hintHidden);
  if (hidden) return null;
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
        onClick={() => write("session", HINT_KEY)}
      >
        <Icon name="close" size={18} />
      </button>
    </p>
  );
}
