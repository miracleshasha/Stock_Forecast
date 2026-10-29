import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import NavProgress from "@/components/NavProgress";
import SearchSheetProvider from "@/components/SearchSheet";
import { getDisplayWho } from "@/lib/auth";

const DESCRIPTION =
  "종목을 검색하면 지금 차트가 어떤 흐름인지 추세·모멘텀·밴드·거래량을 하나의 점수로 요약해 보여드려요.";

export const metadata: Metadata = {
  // 카톡 등 링크 미리보기용 — 배포 주소는 Vercel 이 빌드 때 넣어 줍니다
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000",
  ),
  title: "주가예보",
  description: DESCRIPTION,
  openGraph: {
    title: "주가예보",
    description: DESCRIPTION,
    siteName: "주가예보",
    locale: "ko_KR",
    type: "website",
    url: "/",
  },
};

export const viewport: Viewport = {
  themeColor: "#F2F4F6",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const who = await getDisplayWho();
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <Providers>
          <NavProgress>
            <SearchSheetProvider>
              <TopBar who={who} />
              {children}
              <BottomNav who={who} />
            </SearchSheetProvider>
          </NavProgress>
        </Providers>
        {/* 하루 단위 방문자 집계 — 쿠키를 쓰지 않고 수치만 셉니다 */}
        <Analytics />
      </body>
    </html>
  );
}
