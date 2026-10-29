/**
 * 홈 화면 아이콘을 app/icon.svg 하나에서 만들어 냅니다.
 *
 *   npm run icons
 *
 * 만드는 것:
 *   app/apple-icon.png           iOS 홈 화면 (180). Next 가 apple-touch-icon 링크를 자동 생성
 *   public/icon-192.png          manifest "any"
 *   public/icon-512.png          같음(큰 크기)
 *   public/icon-maskable-512.png manifest "maskable" — 그림을 줄여 잘릴 여백을 둡니다
 *
 * 전부 투명 없이 배경을 꽉 채웁니다. iOS 는 아이콘에 스스로 둥근 모서리를 입히므로
 * 원본의 둥근 모서리를 남기면 모서리에 검은 테두리가 생깁니다.
 *
 * maskable 만 그림을 줄이는 이유: 안드로이드는 아이콘을 원·사각·물방울 등 제조사
 * 모양대로 잘라냅니다. 안전 영역은 가운데 80% 원이라, 원본 그대로 두면 캔들 끝이
 * 잘립니다. 0.78 배로 줄이면 그림의 반대각선이 안전 영역 안에 들어옵니다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** app/icon.svg 의 배경색. 원본을 바꾸면 여기도 같이 바꾸라는 뜻으로 검사합니다. */
const BG = "#191F28";

const src = fs.readFileSync(path.join(root, "app/icon.svg"), "utf8");
if (!src.includes(BG)) {
  throw new Error(`app/icon.svg 의 배경색이 ${BG} 가 아닙니다. scripts/make-icons.mjs 의 BG 를 맞춰 주세요.`);
}

/** 원본에서 배경 사각형을 뺀 그림(캔들)만. 32x32 뷰박스에 가운데(16,16) 정렬입니다. */
const art = src
  .replace(/<svg[^>]*>/, "")
  .replace("</svg>", "")
  .replace(/<rect width="32" height="32"[^>]*\/>/, "")
  .trim();

/** 배경을 꽉 채우고 그림을 scale 배로 줄인 SVG */
const icon = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
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
      const kb = (fs.statSync(path.join(root, out)).size / 1024).toFixed(1);
      console.log(`  ${out.padEnd(32)} ${size}x${size}  ${kb}KB`);
    });

console.log("아이콘 생성:");
await Promise.all([
  png(icon(1), 180, "app/apple-icon.png"),
  png(icon(1), 192, "public/icon-192.png"),
  png(icon(1), 512, "public/icon-512.png"),
  png(icon(0.78), 512, "public/icon-maskable-512.png"),
]);
console.log("완료 — app/manifest.ts 의 icons 경로와 맞는지 확인하세요.");
