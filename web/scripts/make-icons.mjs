/**
 * 홈 화면 추가(PWA)용 아이콘을 app/icon.svg 하나에서 만들어 냅니다.
 *
 *   node scripts/make-icons.mjs
 *
 * 만드는 것:
 *   public/icon-192.png          manifest "any" — 모서리 둥근 원본 그대로
 *   public/icon-512.png          같음(큰 크기)
 *   public/icon-maskable-512.png manifest "maskable" — 배경을 꽉 채우고 그림을 줄임
 *   app/apple-icon.png           iOS 홈 화면 아이콘(180). Next 가 apple-touch-icon 링크를 자동 생성
 *
 * maskable 과 apple 은 왜 따로 만드나:
 *   - maskable: 안드로이드가 원·사각·물방울 등 제조사 모양으로 잘라냅니다. 잘려도 되는
 *     바깥 여백이 필요해서 배경을 투명 없이 꽉 채우고 그림을 안전 영역(가운데 80% 원)
 *     안으로 줄입니다. 원본을 그대로 쓰면 캔들 끝이 잘립니다.
 *   - apple: iOS 가 스스로 둥근 모서리를 입히므로 투명·둥근 모서리가 없어야 합니다.
 *     원본의 둥근 모서리를 그대로 두면 모서리에 검은 테두리가 생깁니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/** app/icon.svg 의 배경색. 아래 BG 와 어긋나면 중단합니다(원본을 고치면 같이 고치라는 뜻). */
const BG = "#191F28";

const src = fs.readFileSync(path.join(root, "app/icon.svg"), "utf8");
if (!src.includes(BG)) {
  throw new Error(`app/icon.svg 의 배경색이 ${BG} 가 아닙니다. scripts/make-icons.mjs 의 BG 를 맞춰 주세요.`);
}

/** 원본에서 배경 사각형을 뺀 그림(캔들)만. 32x32 뷰박스 기준이고 가운데(16,16) 정렬입니다. */
const art = src
  .replace(/<svg[^>]*>/, "")
  .replace("</svg>", "")
  .replace(/<rect width="32" height="32"[^>]*\/>/, "")
  .trim();

/** 배경을 꽉 채우고 그림을 scale 배로 줄인 SVG. 투명·둥근 모서리 없음. */
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${BG}"/>
  <g transform="translate(16 16) scale(${scale}) translate(-16 -16)">
${art}
  </g>
</svg>`;

const png = (svg, size, out) =>
  sharp(Buffer.from(svg))
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, out))
    .then(() => {
      const bytes = fs.statSync(path.join(root, out)).size;
      console.log(`  ${out.padEnd(32)} ${size}x${size}  ${(bytes / 1024).toFixed(1)}KB`);
    });

console.log("아이콘 생성:");
await Promise.all([
  // "any": 원본 그대로(둥근 모서리 + 바깥 투명)
  png(src, 192, "public/icon-192.png"),
  png(src, 512, "public/icon-512.png"),
  // "maskable": 안전 영역 안으로. 0.78 이면 그림의 반대각선이 안전원(반지름 40%) 안에 들어옵니다
  png(fullBleed(0.78), 512, "public/icon-maskable-512.png"),
  // apple: iOS 가 모서리를 깎으므로 꽉 채우되 그림 크기는 원본 비율 유지
  png(fullBleed(1), 180, "app/apple-icon.png"),
]);
console.log("완료 — manifest.ts 의 icons 경로와 맞는지 확인하세요.");
