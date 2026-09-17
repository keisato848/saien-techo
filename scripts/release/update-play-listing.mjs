/**
 * Google Play 掲載情報（ja-JP）を docs/store/google-play/listing-ja.md の内容で更新する。
 *
 * - 単一ソース: listing-ja.md の「## アプリ名」「## 短い説明」「## 詳しい説明」を反映する
 * - 動画だけは Play 側の現行値を維持する
 *
 * **アプリ名も単一ソースから送る**（2026-09-18）。以前は現行値をそのまま送り返していて、
 * listing-ja.md を「掲載文の唯一の正」と書きながらアプリ名だけ反映されていなかった。
 * Play はアプリ名の変更で再審査が入ることがある。
 * - 認証: サービスアカウント JSON（既定 C:/secure/play-service-account.json、
 *   環境変数 PLAY_SERVICE_ACCOUNT_KEY で上書き可）。キーの値は一切出力しない。
 *
 * 使い方: node scripts/release/update-play-listing.mjs [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LISTING_MD = path.join(ROOT, 'docs/store/google-play/listing-ja.md');
const DRY_RUN = process.argv.includes('--dry-run');

// ─── listing-ja.md からセクション抽出 ───────────────────────────────────────
function extractSection(md, heading) {
  const re = new RegExp(`^## ${heading}\\s*$`, 'm');
  const m = re.exec(md);
  if (!m) throw new Error(`listing-ja.md に「## ${heading}」が見つかりません`);
  const start = m.index + m[0].length;
  const next = md.slice(start).search(/^## /m);
  const body = (next === -1 ? md.slice(start) : md.slice(start, start + next)).trim();
  if (!body) throw new Error(`「## ${heading}」の本文が空です`);
  return body;
}

const md = fs.readFileSync(LISTING_MD, 'utf8');
const TITLE = extractSection(md, 'アプリ名');
const SHORT = extractSection(md, '短い説明');
const FULL = extractSection(md, '詳しい説明');

// **Play がどちらの単位で数えるかは未確認**なので、符号位置と UTF-16 単位の
// 両方で検査する。甘い方だけで通すと、送ってから API に弾かれる
const len = (s) => [...s].length;
const worst = (s) => Math.max([...s].length, s.length);
if (worst(TITLE) > 30) throw new Error(`アプリ名が30字超: ${worst(TITLE)}`);
if (/[\r\n]/.test(TITLE)) throw new Error('アプリ名が複数行です');
if (worst(SHORT) > 80) throw new Error(`短い説明が80字超: ${worst(SHORT)}`);
if (worst(FULL) > 4000) throw new Error(`詳しい説明が4000字超: ${worst(FULL)}`);
console.log(`title: ${len(TITLE)}字 / short: ${len(SHORT)}字 / full: ${len(FULL)}字`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  console.log(`アプリ名: ${TITLE}`);
  console.log(SHORT);
  process.exit(0);
}

// ─── edits フロー: insert → listings.get → listings.update → commit ─────────
const client = createEditsClient(await getAccessToken());
const edit = await client.insert();

const cur = await client.getListing(edit.id, 'ja-JP');
console.log('current title:', cur.title);
if (cur.title !== TITLE)
  console.log(`**アプリ名を変更します**: ${cur.title} → ${TITLE}（再審査が入ることがあります）`);

await client.updateListing(edit.id, 'ja-JP', {
  language: 'ja-JP',
  title: TITLE,
  shortDescription: SHORT,
  fullDescription: FULL,
  ...(cur.video ? { video: cur.video } : {}),
});

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id);
