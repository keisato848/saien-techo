/**
 * ブランド素材（アイコン・スプラッシュ・favicon）を SVG から書き出す。
 *
 *   node scripts/assets/generate-brand-assets.mjs
 *   node scripts/assets/generate-brand-assets.mjs --check   # 差分があれば非 0 で終了
 *
 * 正は apps/mobile/assets/brand/mark.svg。PNG は生成物なので直接編集しない。
 *
 * 以前は PowerShell の System.Drawing で描いていたが、
 * (1) mac / CI で再生成できない
 * (2) 形の定義がスクリプトの座標にしか無く、レビューできない
 * の 2 点で行き詰まったため SVG + sharp に置き換えた。
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetsDir = join(rootDir, 'apps', 'mobile', 'assets');
const markPath = join(assetsDir, 'brand', 'mark.svg');

/** app.json の splash.backgroundColor / adaptiveIcon.backgroundColor と揃える */
const PLATE = '#EAF3E0';

const checkOnly = process.argv.includes('--check');

/**
 * マークを指定サイズの正方形に収める。
 *
 * contentRatio は「一辺のうちマークが占める割合」。
 * アダプティブアイコンは外周 33% が切られうるので小さめに置く
 * （Android は前景を 108dp のうち中央 72dp しか保証しない）。
 */
function composeSvg({ size, contentRatio, background }) {
  const mark = readFileSync(markPath, 'utf8');
  const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');

  const drawn = size * contentRatio;
  const offset = (size - drawn) / 2;
  const scale = drawn / 96;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${background ? `  <rect width="${size}" height="${size}" fill="${background}"/>` : ''}
  <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
</svg>`;
}

/*
 * `background` を持つものは**アルファチャンネルごと落とす**（flatten）。
 *
 * Apple は App Store のアプリアイコンに透過・アルファチャンネルを認めない。
 * 背景の rect を敷いても sharp の既定は RGBA のままなので、全ピクセルが
 * 不透明でも「アルファチャンネルを持つ PNG」として出てしまう。
 * prebuild 側が落としてくれる可能性はあるが、Windows では検証できないので
 * 生成時点で確実にしておく（iOS 提出準備・2026-08-13）。
 *
 * 透過が要るもの（アダプティブアイコンの前景・スプラッシュ）は flatten しない。
 */
const TARGETS = [
  // ストア / ランチャー。背景込みの正方形（角丸は端末側が付ける）
  { file: 'icon.png', size: 1024, contentRatio: 0.68, background: PLATE },
  // Android アダプティブアイコンの前景。背景色は app.json 側で塗る。
  // 見えるのは 108dp のうち中央 66dp（約 61%）の円なので、その中に収まる範囲で
  // できるだけ大きく置く。0.46 では実機で明らかに小さかった。
  { file: 'adaptive-icon.png', size: 1024, contentRatio: 0.56, background: null },
  // スプラッシュ。app.json の backgroundColor に載るので透過
  { file: 'splash-icon.png', size: 1024, contentRatio: 0.62, background: null },
  // web の favicon
  { file: 'favicon.png', size: 96, contentRatio: 0.78, background: PLATE },
];

function sha(buffer) {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

let stale = 0;

for (const target of TARGETS) {
  const svg = composeSvg(target);
  let pipeline = sharp(Buffer.from(svg));
  // 背景色を敷くもの＝不透明で良いもの。アルファを落として RGB で書き出す
  if (target.background) pipeline = pipeline.flatten({ background: target.background });
  const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();
  const outPath = join(assetsDir, target.file);

  if (checkOnly) {
    let current = null;
    try {
      current = readFileSync(outPath);
    } catch {
      current = null;
    }
    // PNG のバイト列は圧縮器の版で変わりうるので、画素で比べる
    const same =
      current !== null &&
      sha(await sharp(current).raw().toBuffer()) === sha(await sharp(png).raw().toBuffer());
    if (!same) {
      stale += 1;
      console.error(`[NG] ${target.file} が mark.svg と一致しない`);
    }
    continue;
  }

  writeFileSync(outPath, png);
  console.log(`wrote assets/${target.file} (${target.size}px)`);
}

if (checkOnly) {
  if (stale > 0) {
    console.error(
      `\n[NG] ${stale} 件。node scripts/assets/generate-brand-assets.mjs で書き出し直すこと`,
    );
    process.exit(1);
  }
  console.log('[OK] ブランド素材は mark.svg と一致している');
}
