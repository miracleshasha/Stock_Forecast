"use client";

import { useQuery } from "@tanstack/react-query";
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  TickMarkType,
  createChart,
  type Time,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import type { ChartRange, ChartSeries, Currency } from "@/lib/types";

const UP = "#D92B3A"; // 상승 = 레드 (globals.css --up)
const DOWN = "#1B64DA"; // 하락 = 블루 (--down)
const GRID = "#F2F4F6";
const AXIS = "#8B95A1";

const RANGES: { key: ChartRange; label: string }[] = [
  { key: "1M", label: "1달" },
  { key: "3M", label: "3달" },
  { key: "6M", label: "6달" },
  { key: "1Y", label: "1년" },
  { key: "3Y", label: "3년" },
];

type Opts = { candle: boolean; ma: boolean; bb: boolean; env: boolean; vol: boolean };
const DEFAULT_OPTS: Opts = { candle: false, ma: false, bb: false, env: false, vol: false };
const OPTS_KEY = "sd.chartOpts.v2";

function loadOpts(): Opts {
  if (typeof window === "undefined") return DEFAULT_OPTS;
  try {
    const raw = window.localStorage.getItem(OPTS_KEY);
    if (raw) return { ...DEFAULT_OPTS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_OPTS;
}

export default function PriceChart({ ticker, currency }: { ticker: string; currency: Currency }) {
  const [range, setRange] = useState<ChartRange>("3M");
  const [opts, setOpts] = useState<Opts>(() => loadOpts());
  const hostRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["chart", ticker, range],
    queryFn: async (): Promise<ChartSeries> => {
      const res = await fetch(`/api/stock/${ticker}/chart?range=${range}`);
      if (!res.ok) throw new Error("chart fetch failed");
      return res.json();
    },
  });

  function toggle(key: keyof Opts) {
    setOpts((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        window.localStorage.setItem(OPTS_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  const hasData = !!data && data.candles.length > 0;

  useEffect(() => {
    if (!hostRef.current || !data || data.candles.length === 0) return;
    const el = hostRef.current;
    const candles = data.candles;
    const rising = candles[candles.length - 1].close >= candles[0].close;

    const chart = createChart(el, {
      width: el.clientWidth,
      height: el.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor: AXIS,
        fontFamily: "Pretendard Variable, Pretendard, system-ui, sans-serif",
        fontSize: 11,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: GRID } },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: false,
        // 축 라벨: 연 → "2026년", 월 → "9월", 그 외 → "9/23"
        tickMarkFormatter: (time: Time, type: TickMarkType) => {
          const [y, m, d] = String(time).split("-").map(Number);
          if (type === TickMarkType.Year) return `${y}년`;
          if (type === TickMarkType.Month) return `${m}월`;
          return `${m}/${d}`;
        },
      },
      crosshair: { mode: 0 },
      handleScroll: false,
      handleScale: false,
      localization: {
        locale: "ko-KR",
        priceFormatter: (v: number) =>
          currency === "USD"
            ? v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : Math.round(v).toLocaleString("ko-KR"),
      },
    });

    if (opts.candle) {
      const s = chart.addSeries(CandlestickSeries, {
        upColor: UP, downColor: DOWN,
        borderUpColor: UP, borderDownColor: DOWN,
        wickUpColor: UP, wickDownColor: DOWN,
      });
      s.setData(candles.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    } else {
      const s = chart.addSeries(LineSeries, {
        color: rising ? UP : DOWN,
        lineWidth: 2,
        priceLineVisible: false,
        crosshairMarkerRadius: 4,
      });
      s.setData(candles.map((c) => ({ time: c.time as Time, value: c.close })));
    }

    const addLine = (series: { time: string; value: number }[], color: string, dashed = false) => {
      if (!series.length) return;
      const s = chart.addSeries(LineSeries, {
        color,
        lineWidth: 1,
        lineStyle: dashed ? 2 : 0,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(series.map((p) => ({ time: p.time as Time, value: p.value })));
    };
    if (opts.ma) {
      addLine(data.ma20, "#8B95A1");
      addLine(data.ma60, "#E8A317");
      addLine(data.ma120, "#6B4FBB");
    }
    if (opts.bb) {
      addLine(data.bbUpper, "rgba(232,163,23,.8)");
      addLine(data.bbLower, "rgba(232,163,23,.8)");
    }
    if (opts.env) {
      addLine(data.envUpper, "rgba(27,100,218,.5)", true);
      addLine(data.envLower, "rgba(27,100,218,.5)", true);
    }
    if (opts.vol) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol" });
      chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(
        candles.map((c) => ({
          time: c.time as Time,
          value: c.volume,
          color: c.close >= c.open ? "rgba(217,43,58,.35)" : "rgba(27,100,218,.35)",
        })),
      );
    }

    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: el.clientWidth }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, opts, currency]);

  return (
    <div className="chart">
      {isLoading && <div className="chart-state"><span className="spinner" aria-label="차트 불러오는 중" /></div>}
      {isError && <div className="chart-state">차트를 불러오지 못했어요.</div>}
      {!isLoading && !isError && !hasData && (
        <div className="chart-state">아직 이 종목의 시세 데이터가 없어요.</div>
      )}
      <div
        ref={hostRef}
        className="chart-host"
        role="img"
        aria-label={`${RANGES.find((r) => r.key === range)?.label} 가격 차트`}
        style={{ display: !isLoading && !isError && hasData ? "block" : "none" }}
      />

      <div className="seg" role="tablist" aria-label="차트 기간">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            role="tab"
            aria-selected={range === r.key}
            className={`seg__btn${range === r.key ? " seg__btn--on" : ""}`}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="chart-opts" aria-label="차트 표시 옵션">
        <Chip on={opts.candle} onClick={() => toggle("candle")}>캔들</Chip>
        <Chip on={opts.ma} onClick={() => toggle("ma")}>이동평균</Chip>
        <Chip on={opts.bb} onClick={() => toggle("bb")}>볼린저밴드</Chip>
        <Chip on={opts.env} onClick={() => toggle("env")}>엔벨로프</Chip>
        <Chip on={opts.vol} onClick={() => toggle("vol")}>거래량</Chip>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`chip chip--soft${on ? " chip--on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
    >
      {children}
    </button>
  );
}
