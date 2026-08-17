"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { ChartRange, ChartSeries } from "@/lib/types";

const UP = "#F2545B"; // 상승 = 레드
const DOWN = "#3D7EF2"; // 하락 = 블루
const RANGES: ChartRange[] = ["3M", "6M", "1Y", "3Y"];

type Overlays = { bb: boolean; env: boolean; ma: boolean; vol: boolean };
const TOGGLE_KEY = "sd.chartOverlays";

function loadOverlays(): Overlays {
  if (typeof window === "undefined") return { bb: true, env: true, ma: true, vol: true };
  try {
    const raw = window.localStorage.getItem(TOGGLE_KEY);
    if (raw) return { bb: true, env: true, ma: true, vol: true, ...JSON.parse(raw) };
  } catch {}
  return { bb: true, env: true, ma: true, vol: true };
}

export default function PriceChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState<ChartRange>("6M");
  const [ov, setOv] = useState<Overlays>(() => loadOverlays());
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["chart", ticker, range],
    queryFn: async (): Promise<ChartSeries> => {
      const res = await fetch(`/api/stock/${ticker}/chart?range=${range}`);
      if (!res.ok) throw new Error("chart fetch failed");
      return res.json();
    },
  });

  function toggle(key: keyof Overlays) {
    setOv((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(TOGGLE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  useEffect(() => {
    if (!hostRef.current || !data) return;
    const el = hostRef.current;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: 360,
      layout: {
        background: { color: "transparent" },
        textColor: "#7A939E",
        fontFamily: "var(--mono)",
      },
      grid: {
        vertLines: { color: "rgba(33,53,62,0.4)" },
        horzLines: { color: "rgba(33,53,62,0.4)" },
      },
      rightPriceScale: { borderColor: "#21353E" },
      timeScale: { borderColor: "#21353E", timeVisible: false },
      crosshair: { mode: 0 },
    });
    chartRef.current = chart;

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: UP, downColor: DOWN,
      borderUpColor: UP, borderDownColor: DOWN,
      wickUpColor: UP, wickDownColor: DOWN,
    });
    candle.setData(
      data.candles.map((c) => ({
        time: c.time as Time,
        open: c.open, high: c.high, low: c.low, close: c.close,
      })),
    );

    const lines: ISeriesApi<"Line">[] = [];
    const addLine = (
      series: { time: string; value: number }[],
      color: string,
      opts: { width?: 1 | 2; dashed?: boolean } = {},
    ) => {
      if (!series.length) return;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: opts.width ?? 1,
        lineStyle: opts.dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(series.map((p) => ({ time: p.time as Time, value: p.value })));
      lines.push(s);
    };

    if (ov.ma) {
      addLine(data.ma20, "#8FA3AC");
      addLine(data.ma60, "#E0B44C");
      addLine(data.ma120, "#7A6229");
    }
    if (ov.bb) {
      addLine(data.bbUpper, "rgba(224,180,76,0.7)");
      addLine(data.bbLower, "rgba(224,180,76,0.7)");
      if (!ov.ma) addLine(data.bbMid, "rgba(143,163,172,0.6)");
    }
    if (ov.env) {
      addLine(data.envUpper, "rgba(61,126,242,0.55)", { dashed: true });
      addLine(data.envLower, "rgba(61,126,242,0.55)", { dashed: true });
    }

    if (ov.vol) {
      const vol = chart.addSeries(HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "vol",
      });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(
        data.candles.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(242,84,91,0.5)" : "rgba(61,126,242,0.5)",
        })),
      );
    }

    chart.timeScale().fitContent();

    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      chart.remove();
      chartRef.current = null;
    };
  }, [data, ov]);

  return (
    <div className="chart-wrap">
      <div className="chart-tools">
        <Chip on={ov.bb} onClick={() => toggle("bb")}>볼린저밴드</Chip>
        <Chip on={ov.env} onClick={() => toggle("env")}>엔벨로프</Chip>
        <Chip on={ov.ma} onClick={() => toggle("ma")}>MA 20/60/120</Chip>
        <Chip on={ov.vol} onClick={() => toggle("vol")}>거래량</Chip>
        <span className="chip--range">
          {RANGES.map((r) => (
            <Chip key={r} on={range === r} onClick={() => setRange(r)}>
              {r}
            </Chip>
          ))}
        </span>
      </div>

      {isLoading && <div className="chart-host" style={{ display: "grid", placeItems: "center", color: "var(--dim)" }}>차트 불러오는 중…</div>}
      {isError && <div className="chart-host" style={{ display: "grid", placeItems: "center", color: "var(--dim)" }}>차트 데이터를 불러오지 못했습니다.</div>}
      {!isLoading && !isError && data && data.candles.length === 0 && (
        <div className="chart-host" style={{ display: "grid", placeItems: "center", color: "var(--dim)" }}>
          아직 이 종목의 시세 데이터가 없습니다. 배치를 실행해 주세요.
        </div>
      )}
      <div ref={hostRef} className="chart-host" style={{ display: !isLoading && !isError && data && data.candles.length ? "block" : "none" }} />

      <div className="chart-legend">
        <span><i style={{ background: "var(--brass)" }} />볼린저 상/하단 (20, 2σ)</span>
        <span><i style={{ background: "var(--muted)" }} />중심선 MA20</span>
        <span><i style={{ background: "var(--down)", opacity: 0.7 }} />엔벨로프 ±10%</span>
        <span><i style={{ background: "var(--up)" }} />상승 캔들</span>
        <span><i style={{ background: "var(--down)" }} />하락 캔들</span>
      </div>
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button className={`chip${on ? " chip--on" : ""}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}
