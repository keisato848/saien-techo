/**
 * Google Play のスマホ用スクリーンショット（ja-JP / phoneScreenshots）を
 * docs/store/google-play/store-slides/ の内容で差し替える。
 *
 * **上げるのは素のキャプチャではなく、キャプション入りのスライド**
 * （`compose-store-slides.mjs` の出力）。一覧で見えるのは 1 枚目の上半分だけなので、
 * そこに「解決される困りごと」を載せる。素のキャプチャは `phone-screenshots/`。
 *
 * - 表示順 = ORDER 配列（compose-store-slides.mjs の SLIDES と同じ順にする）
 * - 既存を全削除してから順番にアップロード（アップロード順が表示順になる）
 * - 認証は lib/play-api.mjs（サービスアカウント）
 *
 * 使い方: node scripts/release/update-play-screenshots.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS_DIR = path.join(ROOT, 'docs/store/google-play/store-slides');
const LANG = 'ja-JP';
const IMAGE_TYPE = 'phoneScreenshots';
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * アップロード順（= Play の表示順）。**compose-store-slides.mjs の SLIDES と同じ順**。
 * ファイル名の番号は撮影時の通し番号で、表示順とは一致しない
 * （「写真から記録」は訴求が強いので 5 番目に上げている）。
 */
const ORDER = [
  '01-home.png',
  '09-planting-identify.png',
  '02-plantings.png',
  '03-planting-detail.png',
  '04-harvests.png',
  '08-harvest-reads.png',
  '05-crop-guide.png',
  '07-materials.png',
];

// ─── 検証（存在・PNG・寸法・8枚以内） ────────────────────────────────────────
if (ORDER.length > 8) throw new Error(`Play のスマホスクショは最大8枚（現在 ${ORDER.length}）`);
const plan = ORDER.map((file) => {
  const p = path.join(SHOTS_DIR, file);
  if (!fs.existsSync(p)) throw new Error(`missing: ${file}`);
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not PNG: ${file}`);
  const w = b.readUInt32BE(16);
  const h = b.readUInt32BE(20);
  if (Math.min(w, h) < 320 || Math.max(w, h) > 3840)
    throw new Error(`寸法が Play 要件外 (320..3840): ${file} ${w}x${h}`);
  return { file, path: p, dims: `${w}x${h}`, kb: Math.round(b.length / 1024) };
});

console.log(`plan (${plan.length} files, ${LANG}/${IMAGE_TYPE}):`);
for (const [i, s] of plan.entries()) console.log(`  ${i + 1}. ${s.file} ${s.dims} ${s.kb}KB`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

// ─── edits フロー: insert → deleteall → upload×N → commit ────────────────────
const client = createEditsClient(await getAccessToken());
const edit = await client.insert();
console.log('edit:', edit.id);

await client.deleteAllImages(edit.id, LANG, IMAGE_TYPE);
console.log('deleted existing images');

for (const s of plan) {
  const res = await client.uploadImage(edit.id, LANG, IMAGE_TYPE, s.path);
  console.log(`uploaded: ${s.file} -> ${res.image?.id ?? 'ok'}`);
}

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
