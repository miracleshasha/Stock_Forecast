import type { Metadata, Viewport } from "next";
import "./globals.css";
import Providers from "./providers";
import TopBar from "@/components/TopBar";
import BottomNav from "@/components/BottomNav";
import NavProgress from "@/components/NavProgress";
import SearchSheetProvider from "@/components/SearchSheet";
import AddToHome from "@/components/AddToHome";
import { getDisplayWho } from "@/lib/auth";

export const metadata: Metadata = {
  title: "주가예보",
  description:
    "종목을 검색하면 지금 차트가 어떤 흐름인지 추세·모멘텀·밴드·거래량을 하나의 점수로 요약해 보여드려요.",
  // 홈 화면에 추가했을 때 iOS 설정. 아이콘은 app/apple-icon.png 를 Next 가 자동으로 연결합니다
  appleWebApp: {
    title: "주가예보", // 홈 화면 아이콘 밑에 뜨는 이름 (title 전체가 아니라 이 값)
    statusBarStyle: "default", // 밝은 테마라 기본값(어두운 글씨). 콘텐츠는 상태표시줄 아래에서 시작
  },
};

export const viewport: Viewport = {
  themeColor: "#F2F4F6",
  // 홈 화면 앱은 Safari 툴바가 없어 화면 끝까지 씁니다. 노치·홈 인디케이터와 겹치지 않도록
  // safe-area-inset 을 쓰려면 이 값이 있어야 합니다(globals.css 의 env(safe-area-inset-*)).
  viewportFit: "cover",
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
              <AddToHome />
              <BottomNav who={who} />
            </SearchSheetProvider>
          </NavProgress>
        </Providers>
      </body>
    </html>
  );
}
