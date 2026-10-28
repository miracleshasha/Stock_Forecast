import type { MetadataRoute } from "next";

/** 홈 화면에 추가했을 때의 이름·아이콘·색 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "주가예보",
    short_name: "주가예보",
    description: "지금 차트가 어떤 흐름인지 점수 하나로 요약해 보여드려요.",
    start_url: "/",
    display: "standalone",
    background_color: "#F2F4F6",
    theme_color: "#F2F4F6",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
