/**
 * Play のフィーチャーグラフィック（1024×500）を若葉パレットで書き出す。
 *
 * だいどこ由来の generate-play-promos.mjs は暗色×金の意匠とレシピ画面前提の
 * スライドが丸ごと残っていたので、フィーチャーグラフィックだけ独立させた。
 *
 * ## 設計の決めごと
 *
 * **Play では小さく出る。** 一覧では横 400px 程度まで縮む想定で、要素を詰めない。
 * 入るのは「マーク・アプリ名・一行のコピー」だけ。スクリーンショットの縮小版を
 * 敷き込む案は、その大きさでは何も読めず情報密度だけが上がるので採らない。
 *
 * **文字は SVG のパスではなくシステムフォントで描く。** 和文の webfont を積まない
 * 方針（docs/画面設計.md）に合わせる。環境によって字形が変わるが、
 * 生成物を git に置いて確認するので実害はない。
 *
 * 使い方: node scripts/release/generate-feature-graphic.mjs
 */
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MARK = path.join(ROOT, 'apps/mobile/assets/brand/mark.svg');
const OUT_DIR = path.join(ROOT, 'docs/store/google-play/graphics');
const OUT = path.join(OUT_DIR, 'feature-graphic.png');

const W = 1024;
const H = 500;

// 若葉パレット（apps/mobile/src/constants/theme.ts）
const BG = '#F6F8F1';
const ACCENT = '#5B9B3E';
const ACCENT_INK = '#2F4A25';
const ACCENT_SOFT = '#EAF3E0';
const INK = '#1E2A16';
const INK_DIM = '#5E6B52';

const TITLE = 'さいえん手帳';
const TAGLINE = '育てて、記録して、ちゃんと採れる。';
const SUB = '家庭菜園の栽培記録と、栽培暦にもとづく作業アドバイス';

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * 背景。若葉の淡い面に、畝を思わせる緩い曲線を 2 本だけ引く。
 * 装飾を増やすと縮小時にノイズになるので、これ以上は足さない。
 */
function backgroundSvg() {
  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${BG}"/>
      <stop offset="100%" stop-color="${ACCENT_SOFT}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <path d="M-40 392 Q300 330 1064 400" fill="none" stroke="${ACCENT}" stroke-opacity="0.28" stroke-width="14" stroke-linecap="round"/>
  <path d="M-40 452 Q360 396 1064 462" fill="none" stroke="${ACCENT}" stroke-opacity="0.16" stroke-width="12" stroke-linecap="round"/>
</svg>`;
}

function textSvg() {
  return `
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <text x="330" y="196" fill="${INK}" font-size="72" font-weight="700" letter-spacing="2"
        font-family="Yu Gothic UI, Yu Gothic, Meiryo, sans-serif">${escapeXml(TITLE)}</text>
  <text x="332" y="262" fill="${ACCENT_INK}" font-size="34" font-weight="600" letter-spacing="1"
        font-family="Yu Gothic UI, Yu Gothic, Meiryo, sans-serif">${escapeXml(TAGLINE)}</text>
  <text x="332" y="312" fill="${INK_DIM}" font-size="24" font-weight="400" letter-spacing="0.5"
        font-family="Yu Gothic UI, Yu Gothic, Meiryo, sans-serif">${escapeXml(SUB)}</text>
</svg>`;
}

const markPng = await sharp(await readFile(MARK))
  .resize(208, 208)
  .png()
  .toBuffer();

await mkdir(OUT_DIR, { recursive: true });
await sharp(Buffer.from(backgroundSvg()))
  .composite([
    { input: markPng, left: 88, top: 146 },
    { input: Buffer.from(textSvg()), left: 0, top: 0 },
  ])
  .png()
  .toFile(OUT);

const meta = await sharp(OUT).metadata();
if (meta.width !== W || meta.height !== H) {
  throw new Error(`寸法が違う: ${meta.width}x${meta.height}（Play は ${W}x${H} 固定）`);
}
console.log(`feature graphic: ${path.relative(ROOT, OUT)} (${meta.width}x${meta.height})`);
