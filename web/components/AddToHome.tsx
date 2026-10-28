"use client";

// ============================================================
// 홈 화면에 추가 안내 (2026-10-28)
//
// 왜 환경마다 다르게 보여 주나:
//   - 안드로이드 크롬: beforeinstallprompt 를 가로채 두면 버튼 한 번으로 설치됩니다.
//   - iOS 사파리: 설치 API 가 아예 없습니다. 공유 → 홈 화면에 추가를 사람이 직접
//     눌러야 해서, 그 두 버튼을 그림으로 그려 설명합니다.
//   - 카카오톡·네이버 등 인앱 브라우저: "홈 화면에 추가" 메뉴 자체가 없습니다.
//     여기서 아무리 안내해도 따라올 수 없으므로 먼저 기본 브라우저로 내보냅니다.
//
// 언제 보여 주나:
//   - 하단 배너: 하루에 한 번. 닫으면 그날은 다시 뜨지 않고, 다음 날 다시 띄웁니다.
//     "그날"은 기기의 현지 날짜 기준이라 자정에 바뀝니다.
//   - 전체 시트: 두 번째 방문에 딱 한 번만. 가치를 한 번 본 뒤에 권해야 추가율이
//     올라가지만, 매일 전면으로 막으면 성가시므로 그 뒤로는 배너만 남습니다.
//   - 이미 홈 화면에서 실행 중(standalone)이거나 PC 면 아예 띄우지 않습니다.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Icon from "./Icon";

/** 이 횟수째 방문에 전체 시트를 한 번 띄웁니다. 1 로 두면 첫 방문부터. */
const SHEET_FROM_VISIT = 2;

const KEY = {
  visits: "sd.a2hs.visits",
  hiddenDay: "sd.a2hs.hiddenDay", // 닫은 날(YYYY-MM-DD). 그날 하루만 숨깁니다
  sheetSeen: "sd.a2hs.sheetSeen", // 전체 시트를 이미 한 번 보여 줬는지
  seen: "sd.a2hs.seen", // 세션당 방문 1회 집계용(sessionStorage)
};

/** 기기 현지 날짜 YYYY-MM-DD. UTC 로 하면 한국에서 오전 9시에 날짜가 바뀝니다. */
function dayKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Platform = "ios" | "android" | "other";

/** 안드로이드 크롬이 "설치할 수 있다"고 알려 줄 때 주는 이벤트. 표준 타입이 아직 없어 직접 적습니다. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const readStr = (k: string): string | null => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null; // 시크릿 모드 등에서 접근이 막히면 "기록 없음"으로 봅니다
  }
};
const readNum = (k: string): number => Number(readStr(k)) || 0;
const write = (k: string, v: string) => {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* 저장 못 해도 안내 자체는 동작해야 하므로 무시 */
  }
};

function detectPlatform(ua: string): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS 13+ 는 데스크톱 사파리로 위장합니다 — 터치 지원 여부로 가려냅니다
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** 카카오톡·네이버·인스타 등 앱 안에 들어 있는 브라우저인지. 여기서는 홈 화면에 추가가 불가능합니다. */
function detectInApp(ua: string): boolean {
  return /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp|whale\/.*inapp/i.test(ua);
}

/** 카카오톡만 전용 스킴으로 빠져나갈 수 있어 따로 가려냅니다. */
function detectKakao(ua: string): boolean {
  return /KAKAOTALK/i.test(ua);
}

/**
 * 카카오톡 인앱 브라우저를 기본 브라우저로 넘기는 스킴.
 * 카카오가 공식 문서로 공개한 기능이 아니라 언제든 막힐 수 있습니다 —
 * 실패를 전제로 아래 단계(안드로이드 intent → 수동 안내)가 이어집니다.
 */
const kakaoEscapeUrl = (): string =>
  `kakaotalk://web/openExternal?url=${encodeURIComponent(window.location.href)}`;

/**
 * 안드로이드 기본 브라우저로 넘기는 intent URL.
 * package 를 지정하지 않는 이유: 크롬을 못박으면 삼성 인터넷이 기본이거나 크롬을
 * 비활성화한 기기에서 그냥 실패합니다. 빼 두면 기본 브라우저/선택창이 뜨고,
 * 그래도 안 되면 browser_fallback_url 로 원래 주소에 떨어집니다.
 */
const androidEscapeUrl = (): string => {
  const { host, pathname, search, href } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=https;S.browser_fallback_url=${encodeURIComponent(href)};end`;
};

/** 스킴이 먹었는지 직접 알 방법이 없어, 화면이 가려졌는지로 "떠났다"고 봅니다. */
const leftPage = (): boolean => document.visibilityState === "hidden";

/** 스킴을 호출한 뒤 떠났는지 판단하기까지 기다리는 시간 */
const ESCAPE_WAIT_MS = 1200;

function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS 사파리는 display-mode 대신 이 값을 씁니다
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** 이 안내를 띄울지, 어떤 모습으로 띄울지. 읽기만 하고 아무것도 저장하지 않습니다. */
type Decision = {
  platform: Platform;
  inApp: boolean;
  kakao: boolean; // 카카오톡 인앱이면 전용 스킴으로 한 번에 나갈 수 있습니다
  visits: number;
  fresh: boolean; // 이번 세션에서 방문 횟수를 아직 안 올렸는지
  sheetSeen: boolean; // 전체 시트를 이미 본 적 있는지
};

function decide(): Decision | null {
  if (isStandalone()) return null; // 이미 홈 화면 앱으로 실행 중 — 권할 이유가 없습니다
  const ua = navigator.userAgent;
  const platform = detectPlatform(ua);
  if (platform === "other") return null; // PC 는 대상이 아닙니다

  // 오늘 닫았으면 오늘은 끝. 날짜가 바뀌면 자연히 다시 뜹니다
  if (readStr(KEY.hiddenDay) === dayKey()) return null;

  // 방문 횟수는 브라우저 세션당 한 번만 올립니다(화면 이동으로 늘지 않게).
  // 여기서는 세어만 두고, 실제 저장은 아래 effect 가 합니다.
  let visits = readNum(KEY.visits);
  let fresh = false;
  try {
    fresh = !window.sessionStorage.getItem(KEY.seen);
  } catch {
    fresh = visits === 0; // 저장소가 막혔으면 첫 방문으로 봅니다
  }
  if (fresh) visits += 1;
  return {
    platform,
    inApp: detectInApp(ua),
    kakao: detectKakao(ua),
    visits,
    fresh,
    sheetSeen: readStr(KEY.sheetSeen) === "1",
  };
}

/** 마운트 여부만 알려 주는 구독(구독할 외부 변화가 없어 해지 함수도 비어 있습니다). */
const noopSubscribe = () => () => {};

export default function AddToHome() {
  // 서버 렌더와 어긋나지 않게: 서버·하이드레이션 때는 false, 그 뒤 true 가 됩니다.
  // effect 안에서 setState 하지 않으므로 렌더가 연쇄로 돌지 않습니다.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const decision = useMemo(() => (mounted ? decide() : null), [mounted]);

  const [dismissed, setDismissed] = useState(false);
  const [openedSheet, setOpenedSheet] = useState(false);
  const [installer, setInstaller] = useState<InstallPromptEvent | null>(null);
  const [copied, setCopied] = useState(false);
  /** 인앱 탈출 진행 상태. manual 이면 스킴이 안 먹은 것이라 손으로 하는 안내를 폅니다 */
  const [escape, setEscape] = useState<"idle" | "trying" | "manual">("idle");
  const timers = useRef<number[]>([]);

  const platform: Platform = decision?.platform ?? "other";
  const inApp = decision?.inApp ?? false;
  const kakao = decision?.kakao ?? false;
  const show = decision != null && !dismissed;
  // 전체 시트는 정해진 방문 횟수에 딱 한 번. 그 뒤로는 배너만 하루 한 번 뜹니다
  const autoSheet = decision != null && !decision.sheetSeen && decision.visits >= SHEET_FROM_VISIT;
  const asSheet = openedSheet || autoSheet;

  const hide = useCallback((snooze: boolean) => {
    setDismissed(true);
    if (snooze) write(KEY.hiddenDay, dayKey()); // 오늘 하루만 숨김
  }, []);

  // 언마운트될 때 남은 타이머 정리
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  // 전체 시트를 실제로 띄웠으면 기록해 둡니다(다음부터는 배너만)
  useEffect(() => {
    if (show && asSheet) write(KEY.sheetSeen, "1");
  }, [show, asSheet]);

  // 센 방문 횟수를 저장합니다(decide 는 읽기만 하므로 쓰기는 여기 한 곳)
  useEffect(() => {
    if (!decision?.fresh) return;
    write(KEY.visits, String(decision.visits));
    try {
      window.sessionStorage.setItem(KEY.seen, "1");
    } catch {
      /* 저장 못 해도 안내는 동작합니다 */
    }
  }, [decision]);

  // 안드로이드 크롬의 설치 제안을 가로채 둡니다(우리 버튼으로 대신 띄우려고)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstaller(e as InstallPromptEvent);
    };
    // 안드로이드에서 설치가 끝나면 알려 줍니다. iOS 는 이런 이벤트가 없습니다
    const onInstalled = () => {
      setDismissed(true);
      write(KEY.hiddenDay, dayKey());
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // 시트가 열려 있는 동안 뒤 페이지 스크롤 잠금 + Esc 로 닫기 (검색 시트와 같은 방식)
  useEffect(() => {
    if (!show || !asSheet) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && hide(true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [show, asSheet, hide]);

  const install = async () => {
    if (!installer) return;
    await installer.prompt();
    const { outcome } = await installer.userChoice;
    setInstaller(null);
    if (outcome === "accepted") hide(false);
    else hide(true);
  };

  /**
   * 인앱 브라우저 탈출. 어느 방법도 "성공했는지" 알려 주지 않아서 단계로 내려갑니다.
   *   1) 카카오톡이면 전용 스킴 — 되면 버튼 한 번으로 끝
   *   2) 안드로이드면 intent URL — 기본 브라우저/선택창
   *   3) 둘 다 화면이 그대로면 수동 안내로 전환
   * 각 단계 뒤 ESCAPE_WAIT_MS 동안 화면이 가려졌는지 보고 다음으로 넘어갑니다.
   */
  const escapeInApp = useCallback(async () => {
    setEscape("trying");
    const step = (url: string) =>
      new Promise<boolean>((resolve) => {
        window.location.href = url;
        timers.current.push(
          window.setTimeout(() => resolve(leftPage()), ESCAPE_WAIT_MS),
        );
      });

    if (kakao && (await step(kakaoEscapeUrl()))) return;
    if (platform === "android" && (await step(androidEscapeUrl()))) return;

    // 여기까지 왔으면 화면이 그대로 — 주소라도 복사해 두고 수동 안내를 폅니다
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false); // 복사가 막히면 안내 문구대로 직접 하시면 됩니다
    }
    setEscape("manual");
  }, [kakao, platform]);

  /** 복사만 따로 (수동 안내 화면의 버튼) */
  const copyUrl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, []);

  if (!show) return null;

  // 인앱 브라우저에서 자동으로 빠져나갈 수단이 있는지. iOS 는 카카오톡만 가능합니다
  const canAutoEscape = kakao || platform === "android";
  const browserName = platform === "ios" ? "Safari" : "기본 브라우저";

  const body = inApp ? (
    <>
      <p className="a2hs__lead">
        지금은 <b>{kakao ? "카카오톡 안의 브라우저" : "앱 안의 브라우저"}</b>라 홈 화면에
        추가할 수 없어요. 먼저 {browserName}로 열어 주세요.
      </p>

      {canAutoEscape && escape !== "manual" && (
        <button
          type="button"
          className="a2hs__cta"
          onClick={escapeInApp}
          disabled={escape === "trying"}
        >
          {escape === "trying" ? "여는 중…" : `${browserName}로 열기`}
        </button>
      )}

      {(!canAutoEscape || escape === "manual") && (
        <>
          {escape === "manual" && (
            <p className="a2hs__note">
              자동으로 열리지 않았어요. 아래대로 해 주세요.
            </p>
          )}
          <button type="button" className="a2hs__cta" onClick={copyUrl}>
            {copied ? "주소를 복사했어요" : "주소 복사하기"}
          </button>
          <ol className="a2hs__steps">
            <li>
              <span className="a2hs__num">1</span>
              <span>
                <b>더보기(⋯)</b> 메뉴에서{" "}
                <b>{kakao ? "다른 브라우저로 열기" : `${browserName}로 열기`}</b> 를 선택하세요.
              </span>
            </li>
            <li>
              <span className="a2hs__num">2</span>
              <span>메뉴가 없다면 {browserName}를 열고 복사한 주소를 붙여넣으세요.</span>
            </li>
          </ol>
        </>
      )}
    </>
  ) : platform === "ios" ? (
    <>
      <p className="a2hs__lead">Safari에서 두 번만 누르면 앱처럼 쓸 수 있어요.</p>
      <ol className="a2hs__steps">
        <li>
          <span className="a2hs__num">1</span>
          <span>
            아래 <ShareGlyph /> <b>공유</b> 버튼을 누르세요.
            <em className="a2hs__hint">안 보이면 ··· 메뉴 안에 있어요</em>
          </span>
        </li>
        <li>
          <span className="a2hs__num">2</span>
          <span>
            목록을 내려 <PlusSquareGlyph /> <b>홈 화면에 추가</b> 를 선택하세요.
          </span>
        </li>
      </ol>
      <p className="a2hs__note">
        추가한 뒤 즐겨찾기를 보려면 전화번호를 한 번 더 입력해야 할 수 있어요.
      </p>
    </>
  ) : installer ? (
    <>
      <p className="a2hs__lead">버튼 한 번이면 홈 화면에 추가돼요.</p>
      <button type="button" className="a2hs__cta" onClick={install}>
        홈 화면에 추가
      </button>
    </>
  ) : (
    <>
      <p className="a2hs__lead">크롬에서 두 번만 누르면 앱처럼 쓸 수 있어요.</p>
      <ol className="a2hs__steps">
        <li>
          <span className="a2hs__num">1</span>
          <span>
            오른쪽 위 <b>⋮</b> 메뉴를 누르세요.
          </span>
        </li>
        <li>
          <span className="a2hs__num">2</span>
          <span>
            <b>앱 설치</b> 또는 <b>홈 화면에 추가</b> 를 선택하세요.
          </span>
        </li>
      </ol>
    </>
  );

  if (!asSheet) {
    // 첫 방문: 하단 탭 위에 얇은 배너만. 콘텐츠를 가리지 않습니다
    return (
      <div className="a2hs-bar" role="region" aria-label="홈 화면에 추가 안내">
        <div className="a2hs-bar__in">
          <span className="a2hs-bar__ico" aria-hidden="true">
            <AppGlyph />
          </span>
          <span className="a2hs-bar__txt">홈 화면에 추가해 앱처럼 쓰기</span>
          <button type="button" className="a2hs-bar__go" onClick={() => setOpenedSheet(true)}>
            보기
          </button>
          <button
            type="button"
            className="iconbtn a2hs-bar__x"
            onClick={() => hide(true)}
            aria-label="안내 닫기"
          >
            <Icon name="close" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="a2hs" role="dialog" aria-modal="true" aria-label="홈 화면에 추가">
      <button
        type="button"
        className="a2hs__scrim"
        onClick={() => hide(true)}
        aria-label="안내 닫기"
      />
      <div className="a2hs__panel">
        <div className="a2hs__hd">
          <span className="a2hs__mark" aria-hidden="true">
            <AppGlyph />
          </span>
          <button
            type="button"
            className="iconbtn"
            onClick={() => hide(true)}
            aria-label="안내 닫기"
          >
            <Icon name="close" />
          </button>
        </div>
        <h2 className="a2hs__t">주가예보를 앱처럼</h2>
        {body}
        <button type="button" className="a2hs__later" onClick={() => hide(true)}>
          다음에 할게요
        </button>
      </div>
    </div>
  );
}

/* ---------- 직접 그린 아이콘 ---------- */
/* iOS 버튼을 스크린샷 대신 그림으로 그립니다. 용량이 작고, iOS 버전마다 다른
   화면 생김새에 덜 민감하며, 다크/라이트 어디서나 글자색을 따라갑니다. */

/** iOS 공유 버튼: 위로 나가는 화살표가 담긴 상자 */
function ShareGlyph() {
  return (
    <svg className="a2hs__g" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5v11" />
      <path d="M8.5 7L12 3.5 15.5 7" />
      <path d="M7 11H5.5v9h13v-9H17" />
    </svg>
  );
}

/** iOS "홈 화면에 추가" 항목의 네모 안 더하기 */
function PlusSquareGlyph() {
  return (
    <svg className="a2hs__g" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 9v6M9 12h6" />
    </svg>
  );
}

/** 홈 화면에 놓인 앱 아이콘 느낌 */
function AppGlyph() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" width="28" height="28">
      <rect width="32" height="32" rx="9" fill="#191F28" />
      <path d="M11 7.5v17" stroke="#6EA8FF" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7.5" y="11" width="7" height="10" rx="2" fill="#3D86F5" />
      <path d="M21 5.5v21" stroke="#FF6B78" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="17.5" y="8" width="7" height="14" rx="2" fill="#F04452" />
    </svg>
  );
}
