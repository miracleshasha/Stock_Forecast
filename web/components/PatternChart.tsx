import type { MiniCandle } from "@/lib/db";

/** 패턴이 몇 개의 봉으로 이뤄지는지 (batch/patterns.py 정의와 같아야 함) */
export const PATTERN_SPAN: Record<string, number> = {
  bull_engulfing: 2, bear_engulfing: 2, piercing: 2, dark_cloud: 2,
  bull_harami: 2, bear_harami: 2, tweezer_bottom: 2, tweezer_top: 2,
  morning_star: 3, evening_star: 3, three_white_soldiers: 3, three_black_crows: 3,
  bb_lower_break: 2, bb_lower_reentry: 2, bb_upper_break: 2, bb_upper_reentry: 2,
};
const VOLUME_PATTERNS = new Set(["low_volume_surge", "high_volume_surge", "low_volume_dry", "high_volume_dry"]);

const W = 340;
const PRICE_TOP = 22;
const PRICE_H = 112;
const VOL_TOP = PRICE_TOP + PRICE_H + 10;
const VOL_H = 34;
const H = VOL_TOP + VOL_H + 18;

const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
};

/**
 * 최근 일봉 미니 차트. 마지막 span 개 봉(패턴 구간)을 배경으로 강조합니다.
 * 상승 = 빨강, 하락 = 파랑(사이트 공통 규약). 서버에서 SVG 로 그려 별도 라이브러리가 없습니다.
 */
export default function PatternChart({
  candles,
  patternKeys,
  label,
}: {
  candles: MiniCandle[];
  patternKeys: string[];
  label: string;
}) {
  if (candles.length < 3) return null;
  const span = Math.max(1, ...patternKeys.map((k) => PATTERN_SPAN[k] ?? 1));
  const volumeFocus = patternKeys.some((k) => VOLUME_PATTERNS.has(k));
  const bandFocus = patternKeys.some((k) => k.startsWith("bb_"));

  const n = candles.length;
  const slot = W / n;
  const bodyW = Math.max(4, slot * 0.56);
  // 볼린저 패턴이면 밴드선도 그리므로 축 범위에 포함
  const bandVals = bandFocus
    ? candles.flatMap((c) => [c.bbUpper, c.bbLower]).filter((v): v is number => v != null)
    : [];
  const hi = Math.max(...candles.map((c) => c.high), ...bandVals);
  const lo = Math.min(...candles.map((c) => c.low), ...bandVals);
  const pad = (hi - lo) * 0.06 || hi * 0.01 || 1;
  const yP = (v: number) => PRICE_TOP + ((hi + pad - v) / (hi - lo + 2 * pad)) * PRICE_H;
  const maxV = Math.max(...candles.map((c) => c.volume)) || 1;
  // 20일 평균은 여기 데이터(12봉)로는 못 구하니, 보이는 구간 평균을 점선으로(거래량 '평소' 감 잡기용)
  const avgV = candles.reduce((a, c) => a + c.volume, 0) / n;
  const yV = (v: number) => VOL_TOP + VOL_H - (v / maxV) * VOL_H;
  const hx = (n - span) * slot;

  return (
    <figure className="pchart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`최근 ${n}거래일 캔들 차트, 마지막 ${span}개 봉이 ${label} 구간`}>
        {/* 패턴 구간 강조 */}
        <rect x={hx + 1} y={4} width={span * slot - 2} height={H - 22} rx={8} className="pchart__hl" />
        {/* 강조 구간은 항상 오른쪽 끝이라, 라벨은 오른쪽 정렬(1봉짜리여도 잘리지 않게) */}
        <text x={W - 4} y={15} textAnchor="end" className="pchart__hltext">
          {label}
        </text>

        {bandFocus && (
          <g className="pchart__band">
            {(["bbUpper", "bbLower"] as const).map((k) => {
              const pts = candles
                .map((c, i) => (c[k] != null ? `${(i * slot + slot / 2).toFixed(1)},${yP(c[k]!).toFixed(1)}` : null))
                .filter(Boolean)
                .join(" ");
              return pts ? <polyline key={k} points={pts} /> : null;
            })}
          </g>
        )}

        {candles.map((c, i) => {
          const x = i * slot + slot / 2;
          const up = c.close > c.open;
          const down = c.close < c.open;
          const cls = up ? "pchart__up" : down ? "pchart__down" : "pchart__flat";
          const top = yP(Math.max(c.open, c.close));
          const bot = yP(Math.min(c.open, c.close));
          return (
            <g key={c.date} className={cls}>
              <line x1={x} x2={x} y1={yP(c.high)} y2={yP(c.low)} strokeWidth={1.4} />
              <rect x={x - bodyW / 2} y={top} width={bodyW} height={Math.max(1.5, bot - top)} rx={1} />
              <rect
                x={x - bodyW / 2}
                y={yV(c.volume)}
                width={bodyW}
                height={Math.max(1, VOL_TOP + VOL_H - yV(c.volume))}
                className={volumeFocus && i >= n - span ? "" : "pchart__vol"}
              />
            </g>
          );
        })}

        <line x1={0} x2={W} y1={yV(avgV)} y2={yV(avgV)} className="pchart__avg" />
        <text x={0} y={H - 4} className="pchart__axis">{md(candles[0].date)}</text>
        <text x={W} y={H - 4} textAnchor="end" className="pchart__axis">{md(candles[n - 1].date)}</text>
        <text x={0} y={VOL_TOP - 2} className="pchart__axis">거래량</text>
      </svg>
      <figcaption className="caption" style={{ padding: 0 }}>
        최근 {n}거래일 일봉이에요. 강조한 {span === 1 ? "봉" : `${span}개 봉`}에서 패턴이 나왔어요
        {bandFocus ? " · 주황 선은 볼린저 밴드 상·하단이에요" : ""}
        {volumeFocus ? " · 아래 점선은 이 구간 평균 거래량이에요" : ""}.
      </figcaption>
    </figure>
  );
}
