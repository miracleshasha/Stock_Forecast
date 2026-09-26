import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import NavProgress from "@/components/NavProgress";

export const metadata: Metadata = {
  title: "시그널데스크",
  description:
    "종목을 검색하면 지금 차트가 어떤 흐름인지 추세·모멘텀·밴드·거래량을 하나의 점수로 요약해 보여드려요.",
};

export const viewport: Viewport = {
  themeColor: "#F2F4F6",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
            <TopBar />
            {children}
            <BottomNav />
          </NavProgress>
        </Providers>
      </body>
    </html>
  );
}
