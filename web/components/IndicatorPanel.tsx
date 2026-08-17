import type { Indicators, Macro, Signal } from "@/lib/types";
import { formatNum, formatPct } from "@/lib/format";

type Tone = "up" | "down" | "neu";
const pip = (t: Tone) => `pip pip--${t}`;

// batch/scoring.py WEIGHTS 와 일치해야 함
const GROUP_WEIGHT: Record<string, number> = {
  trend: 34, momentum: 17, band: 17, volume: 17, macro: 15,
};

function scoreTag(v: number) {
  const t: Tone = v > 1 ? "up" : v < -1 ? "down" : "neu";
  return { cls: t, text: `${v > 0 ? "+" : ""}${v}` };
}

function barWidth(group: string, v: number) {
  const w = GROUP_WEIGHT[group] ?? 20;
  return `${Math.min(100, Math.round((Math.abs(v) / w) * 100))}%`;
}

// ---- per-indicator tone heuristics (표시용) ----
function maArrangeTone(i: Indicators): Tone {
  if (i.ma20 == null || i.ma60 == null || i.ma120 == null) return "neu";
  if (i.ma20 > i.ma60 && i.ma60 > i.ma120) return "up";
  if (i.ma20 < i.ma60 && i.ma60 < i.ma120) return "down";
  return "neu";
}
function maArrangeText(i: Indicators): string {
  const t = maArrangeTone(i);
  if (t === "up") return "정배열 (20>60>120)";
  if (t === "down") return "역배열 (20<60<120)";
  return "혼조";
}
function rsiTone(v: number | null): Tone {
  if (v == null) return "neu";
  if (v >= 55 && v <= 70) return "up";
  if (v < 30 || v > 80) return "down";
  return "neu";
}
function macdTone(i: Indicators): Tone {
  if (i.macd == null || i.macdSignal == null) return "neu";
  if (i.macd > i.macdSignal) return "up";
  if (i.macd < i.macdSignal) return "down";
  return "neu";
}
function macdText(i: Indicators): string {
  const t = macdTone(i);
  if (t === "up") return "골든크로스";
  if (t === "down") return "데드크로스";
  return "중립";
}
function pctBTone(v: number | null): Tone {
  if (v == null) return "neu";
  if (v >= 0.5 && v <= 0.8) return "up";
  if (v < 0.2) return "down";
  return "neu";
}
function vixTone(v: number | null): Tone {
  if (v == null) return "neu";
  if (v < 15) return "up";
  if (v > 25) return "down";
  return "neu";
}

export default function IndicatorPanel({
  signal,
  indicators,
  macro,
  close,
  currency,
}: {
  signal: Signal;
  indicators: Indicators | null;
  macro: Macro | null;
  close: number | null;
  currency: "KRW" | "USD";
}) {
  const i = indicators;
  const bd = signal.breakdown;
  const vsMa20 =
    close != null && i?.ma20 ? ((close - i.ma20) / i.ma20) * 100 : null;
  const trendTone = maArrangeTone(i ?? ({} as Indicators));

  return (
    <div>
      <div className="plate plate--muted section-label">판정 근거 · 기여도순</div>
      <div className="grid2">
        {/* 추세 */}
        <Group name="추세" weight={34} value={bd.trend}>
          <Row tone={trendTone} k="MA 배열" v={i ? maArrangeText(i) : "—"} />
          <Row
            tone={vsMa20 == null ? "neu" : vsMa20 >= 5 ? "up" : vsMa20 <= -5 ? "down" : "neu"}
            k="종가 vs MA20"
            v={formatPct(vsMa20)}
          />
        </Group>

        {/* 모멘텀 */}
        <Group name="모멘텀" weight={17} value={bd.momentum}>
          <Row tone={rsiTone(i?.rsi14 ?? null)} k="RSI(14)" v={formatNum(i?.rsi14 ?? null, 1)} />
          <Row tone={macdTone(i ?? ({} as Indicators))} k="MACD" v={i ? macdText(i) : "—"} />
        </Group>

        {/* 밴드 위치 */}
        <Group name="밴드 위치" weight={17} value={bd.band}>
          <Row tone={pctBTone(i?.bbPercentB ?? null)} k="볼린저 %B" v={formatNum(i?.bbPercentB ?? null)} />
          <Row tone="neu" k="밴드폭" v={formatNum(i?.bbWidth ?? null, 3)} />
          <Row
            tone={close != null && i?.envUpper && close > i.envUpper ? "down" : "neu"}
            k="엔벨로프"
            v={close != null && i?.envUpper && close > i.envUpper ? "상단 이탈(과열)" : "밴드 내"}
          />
        </Group>

        {/* 거래량 */}
        <Group name="거래량" weight={17} value={bd.volume}>
          <Row
            tone={i?.volRatio20 != null && i.volRatio20 >= 1.5 ? "up" : "neu"}
            k="20일 평균 대비"
            v={i?.volRatio20 != null ? `${formatNum(i.volRatio20, 1)}배` : "—"}
          />
          <Row tone="neu" k="OBV" v={i?.obv != null ? i.obv.toLocaleString() : "—"} />
        </Group>
      </div>

      {/* 매크로 */}
      <div className="plate plate--muted section-label">매크로 · 가중 15% · 종목 무관 공통</div>
      <div className="card">
        <div className="card__hd">
          <span className="card__t">시장 환경</span>
          <span className={`card__v ${scoreTag(bd.macro).cls}`}>{scoreTag(bd.macro).text}</span>
        </div>
        <Row tone={vixTone(macro?.vix ?? null)} k="VIX (공포지수)" v={formatNum(macro?.vix ?? null, 1)} />
        <Row tone="neu" k="VKOSPI" v={formatNum(macro?.vkospi ?? null, 1)} />
        <Row tone="neu" k="미 국채 10년물" v={macro?.us10y != null ? `${formatNum(macro.us10y)}%` : "—"} />
        <Row tone="neu" k="USD/KRW" v={macro?.usdkrw != null ? macro.usdkrw.toLocaleString() : "—"} />
        {bd.rs20 != null && (
          <Row
            tone={bd.rs20 >= 0.5 ? "up" : bd.rs20 <= -0.5 ? "down" : "neu"}
            k="지수 대비 상대강도(20일)"
            v={formatPct(bd.rs20, 1)}
          />
        )}
      </div>
    </div>
  );
}

function Group({
  name,
  weight,
  value,
  children,
}: {
  name: string;
  weight: number;
  value: number;
  children: React.ReactNode;
}) {
  const key = { 추세: "trend", 모멘텀: "momentum", "밴드 위치": "band", 거래량: "volume" }[name] ?? "band";
  const st = scoreTag(value);
  return (
    <div className="card">
      <div className="card__hd">
        <span className="card__t">
          {name} · 가중 {weight}%
        </span>
        <span className={`card__v ${st.cls}`}>{st.text}</span>
      </div>
      {children}
      <div className="bar">
        <div className="bar__f" style={{ width: barWidth(key, value) }} />
      </div>
    </div>
  );
}

function Row({ tone, k, v }: { tone: Tone; k: string; v: string }) {
  return (
    <div className="row">
      <span className={pip(tone)} />
      <span className="row__k">{k}</span>
      <span className={`row__v ${tone === "neu" ? "" : tone}`}>{v}</span>
    </div>
  );
}
