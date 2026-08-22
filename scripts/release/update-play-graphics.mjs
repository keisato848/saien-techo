/**
 * Play ストア掲載のフィーチャーグラフィックとアイコンを反映する。
 *
 * 単一ソース:
 * - フィーチャーグラフィック: docs/store/google-play/graphics/feature-graphic.png
 *   （生成は scripts/release/generate-feature-graphic.mjs）
 * - アイコン: apps/mobile/assets/icon.png（意匠は scripts/generate-icons.mjs。
 *   Play 要件の 512x512 へはここで縮小する — 元 PNG は直接編集しない）
 *
 * 使い方: node scripts/release/update-play-graphics.mjs [--dry-run]
 * 認証: C:/secure/play-service-account.json（PLAY_SERVICE_ACCOUNT_KEY で上書き可）
 * 注意: どちらも Play の審査を経てから公開される（説明文より遅い）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LANG = 'ja-JP';
const DRY_RUN = process.argv.includes('--dry-run');

const FEATURE = path.join(ROOT, 'docs/store/google-play/graphics/feature-graphic.png');
const ICON_SRC = path.join(ROOT, 'apps/mobile/assets/icon.png');

// ─── 検証と前処理 ────────────────────────────────────────────────────────────
for (const p of [FEATURE, ICON_SRC]) {
  if (!fs.existsSync(p)) throw new Error(`missing: ${p}`);
}
const featureMeta = await sharp(FEATURE).metadata();
if (featureMeta.width !== 1024 || featureMeta.height !== 500) {
  throw new Error(
    `フィーチャーグラフィックは 1024x500 固定（現在 ${featureMeta.width}x${featureMeta.height}）`,
  );
}

// アイコンは 512x512 32bit PNG が要件。1024 版から縮小した一時ファイルを作る
const iconTmp = path.join(os.tmpdir(), 'saien-play-icon-512.png');
await sharp(ICON_SRC).resize(512, 512).png().toFile(iconTmp);

console.log(`feature: ${path.relative(ROOT, FEATURE)} (1024x500)`);
console.log(`icon   : ${path.relative(ROOT, ICON_SRC)} -> 512x512`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

// ─── edits フロー: insert → (deleteall → upload)×2 → commit ─────────────────
const client = createEditsClient(await getAccessToken());
const edit = await client.insert();
console.log('edit:', edit.id);

await client.deleteAllImages(edit.id, LANG, 'featureGraphic');
const fg = await client.uploadImage(edit.id, LANG, 'featureGraphic', FEATURE);
console.log(`uploaded: featureGraphic -> ${fg.image?.id ?? 'ok'}`);

await client.deleteAllImages(edit.id, LANG, 'icon');
const ic = await client.uploadImage(edit.id, LANG, 'icon', iconTmp);
console.log(`uploaded: icon -> ${ic.image?.id ?? 'ok'}`);

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
fs.rmSync(iconTmp, { force: true });
