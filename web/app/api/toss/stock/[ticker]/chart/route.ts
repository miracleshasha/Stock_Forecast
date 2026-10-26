// 차트 시계열(가격·이동평균·밴드)은 판정 값이 없어 웹과 같은 데이터를 그대로 씁니다
export { GET } from "@/app/api/stock/[ticker]/chart/route";

export const dynamic = "force-dynamic";
