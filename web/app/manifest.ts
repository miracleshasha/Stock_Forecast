import type { MetadataRoute } from "next";

/**
 * 홈 화면에 추가했을 때 앱처럼 뜨게 하는 설정 (2026-10-28).
 *
 * 이 파일이 없으면 홈 화면에 추가해도 주소창이 그대로 있는 "북마크"가 됩니다.
 * display: "standalone" 이 주소창·툴바를 없애고, icons 가 홈 화면 아이콘이 됩니다.
 *
 * 아이콘은 app/icon.svg 에서 scripts/make-icons.mjs 로 만듭니다(원본을 고치면 다시 실행).
 * iOS 홈 화면 아이콘은 이 파일이 아니라 app/apple-icon.png 를 씁니다 — iOS 는
 * manifest 의 icons 를 보지 않습니다.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "주가예보",
    short_name: "주가예보",
    description:
      "종목을 검색하면 지금 차트가 어떤 흐름인지 추세·모멘텀·밴드·거래량을 하나의 점수로 요약해 보여드려요.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    // 실행 직후 스플래시 색. 앱 바탕색(--bg)과 같아야 깜빡임이 없습니다
    background_color: "#F2F4F6",
    // 상태 표시줄 색. layout.tsx 의 viewport.themeColor 와 같은 값이어야 합니다
    theme_color: "#F2F4F6",
    lang: "ko",
    categories: ["finance"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // 안드로이드가 제조사 모양대로 잘라내는 용도. 바깥 여백이 넉넉한 별도 이미지입니다
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
