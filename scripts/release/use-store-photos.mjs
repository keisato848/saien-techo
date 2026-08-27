/**
 * 掲載スクショ用に、サンプル写真を一時的に本物の菜園写真へ差し替える。
 *
 * ## なぜ差し替え方式なのか
 *
 * 「掲載スクショには本物の写真を使うが、**配布物には入れない**」を実現したい。
 * ところが `seed-photos.ts` は `require('../../assets/sample-photos/…')` で読むので、
 * **Metro がビルド時に静的解決して AAB へ同梱する**（CLAUDE.md §4b。実行時フラグでは
 * 止まらない — サンプル写真 4 枚が `EXPO_PUBLIC_ENABLE_SAMPLE_DATA` 無効の
 * ビルドにも入っていた実績がある）。
 *
 * 端末のギャラリーから実行時に読む案も検討したが、リリース署名のビルドは
 * `run-as` できず、`adb` が書ける場所（`/sdcard`）を権限なしで読めないため成立しない。
 *
 * そこで **「取得ビルドのときだけファイルを差し替え、撮り終えたら戻す」**。
 * 配布用ビルドは常に元のサンプル写真を持つ。
 *
 * ## 安全策
 *
 * - **コピー時に必ず再エンコードして EXIF を落とす**。提供写真には GPS 座標
 *   （緯度・経度・標高）が入っていた実績があるので、万一コミットされても
 *   撮影場所は出ない
 * - `--restore` は `git checkout` で戻し、**戻ったことを検証**する
 * - 差し替え中は `--status` で分かる。取得手順の最後に `--restore` を置くこと
 *
 * 使い方:
 *   node scripts/release/use-store-photos.mjs --status
 *   node scripts/release/use-store-photos.mjs --apply --from C:/path/to/photos
 *   node scripts/release/use-store-photos.mjs --restore
 *
 * `--from` のディレクトリには**枠の名前**でファイルを置く（拡張子は何でもよい）:
 *   harvest.*        収穫アルバム・「写真から記録」に出る（2 か所で使い回す）
 *   planting.*       栽培のカバー写真
 *   care-planter.*   作業ログ（プランター）
 *   care-seedling.*  作業ログ（苗）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ASSET_DIR = path.join(ROOT, 'apps/mobile/assets/sample-photos');
/** git に渡す相対パス（Windows でも / 区切りにする） */
const ASSET_REL = 'apps/mobile/assets/sample-photos';

/** 枠 → 差し替え先のファイル名（seed-photos.ts の require と一致させる） */
const SLOTS = {
  harvest: 'harvest-tomato.jpg',
  planting: 'planting-tomato.jpg',
  'care-planter': 'care-planter.jpg',
  'care-seedling': 'care-seedling.jpg',
};

/** 掲載スクショは長辺 1600px あれば足りる（端末の保存時と同じ上限） */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 82;

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function git(...cliArgs) {
  return execFileSync('git', cliArgs, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/** 差し替え中か（サンプル写真に未コミットの変更があるか） */
function modifiedAssets() {
  return git('status', '--porcelain', '--', ASSET_REL)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function showStatus() {
  const modified = modifiedAssets();
  if (modified.length === 0) {
    console.log('サンプル写真: 元のまま（配布用と同じ）');
    return 0;
  }
  console.log('⚠ サンプル写真が差し替わっています。撮り終えたら --restore してください:');
  for (const line of modified) console.log(`  ${line}`);
  return 1;
}

async function apply() {
  const from = opt('--from');
  if (!from) throw new Error('--from <ディレクトリ> が要ります');
  if (!fs.existsSync(from)) throw new Error(`ディレクトリがありません: ${from}`);

  // **既に差し替え中なら止める。** 二重に当てると --restore で何が戻るか分からなくなる
  if (modifiedAssets().length > 0) {
    throw new Error('サンプル写真が既に差し替わっています。先に --restore してください');
  }

  const available = fs.readdirSync(from);
  let applied = 0;
  for (const [slot, target] of Object.entries(SLOTS)) {
    const source = available.find((name) => path.parse(name).name === slot);
    if (!source) {
      console.log(`  skip ${slot.padEnd(14)} （${from} に ${slot}.* がありません）`);
      continue;
    }
    const destination = path.join(ASSET_DIR, target);
    // **必ず再エンコードする。** コピーだと EXIF（GPS 座標）がそのまま残る
    await sharp(path.join(from, source))
      .rotate() // EXIF の向きを画素へ焼き込んでから捨てる
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY })
      .toFile(destination);
    const kb = Math.round(fs.statSync(destination).size / 1024);
    console.log(`  ${slot.padEnd(14)} ← ${source}  (${kb}KB・EXIF 除去済み)`);
    applied += 1;
  }

  if (applied === 0) throw new Error('差し替えたファイルがありません（枠の名前を確認）');

  console.log(`\n${applied} 枚を差し替えました。この状態でスクショを撮ってください。`);
  console.log('**撮り終えたら必ず** node scripts/release/use-store-photos.mjs --restore');
  return 0;
}

function restore() {
  const before = modifiedAssets();
  if (before.length === 0) {
    console.log('差し替えはありません（既に元のまま）');
    return 0;
  }
  git('checkout', '--', ASSET_REL);
  const after = modifiedAssets();
  if (after.length > 0) {
    console.error('⚠ 戻しきれませんでした:');
    for (const line of after) console.error(`  ${line}`);
    return 1;
  }
  console.log(`${before.length} 枚を元に戻しました（配布用と同じ状態）`);
  return 0;
}

try {
  const exitCode = args.includes('--restore')
    ? restore()
    : args.includes('--apply')
      ? await apply()
      : showStatus();
  process.exit(exitCode);
} catch (error) {
  // スタックトレースは要らない。何をすればいいかだけ出す
  console.error(`エラー: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
