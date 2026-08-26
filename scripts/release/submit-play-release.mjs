/**
 * AAB を Google Play の指定トラックへ提出する（WBS 3.9）。
 *
 * edits フロー: insert → bundles.upload → tracks.update(リリースノート込み) → commit。
 * リリースノートは docs/store/google-play/listing-ja.md の「## リリースノート」節が単一ソース。
 *
 * 使い方:
 *   node scripts/release/submit-play-release.mjs --dry-run          # 検証のみ
 *   node scripts/release/submit-play-release.mjs                    # production へ
 *   node scripts/release/submit-play-release.mjs --track internal   # トラック指定
 *
 * 認証: C:/secure/play-service-account.json（PLAY_SERVICE_ACCOUNT_KEY で上書き可）
 * 注意: commit 後は Google の審査キューに入る。新規アプリの初回審査は数日かかる。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_BASE, UPLOAD_BASE, createEditsClient, getAccessToken } from './lib/play-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AAB = path.join(ROOT, 'apps/mobile/android/app/build/outputs/bundle/release/app-release.aab');
const LISTING = path.join(ROOT, 'docs/store/google-play/listing-ja.md');

const DRY_RUN = process.argv.includes('--dry-run');
const trackIndex = process.argv.indexOf('--track');
const TRACK = trackIndex >= 0 ? process.argv[trackIndex + 1] : 'production';

// ─── 入力の検証 ──────────────────────────────────────────────────────────────
if (!fs.existsSync(AAB)) throw new Error(`AAB がありません: ${AAB}`);
const aabStat = fs.statSync(AAB);
if (aabStat.size < 5_000_000) throw new Error(`AAB が小さすぎます（${aabStat.size} bytes）`);

// **鮮度チェック — 「この AAB はいま出そうとしている版か」。**
// 1.1 で 8/14 の古い AAB（v1.0.0）を検証して PASS と報告しかけた（提出前に発覚）。
// versionName / versionCode が app.json と一致し、app.json の最終コミットより新しいことを
// 送信前に機械で確かめる。実装は check-artifact-version.py が単一ソース（二重管理にしない）。
const freshness = spawnSync(
  'python',
  [path.join(ROOT, 'scripts/release/check-artifact-version.py'), AAB, '--quiet'],
  { stdio: 'inherit', encoding: 'utf8' },
);
if (freshness.status !== 0) {
  throw new Error(
    freshness.status === 2
      ? 'AAB のバージョンを読めませんでした（check-artifact-version.py）。提出を中止します'
      : 'AAB が app.json と一致しないか古いビルドです。ビルドし直してから提出してください',
  );
}

const listing = fs.readFileSync(LISTING, 'utf8');
const notesMatch = listing.match(/## リリースノート[^\n]*\n\n([\s\S]*?)(?=\n## |$)/);
if (!notesMatch) throw new Error('listing-ja.md に「## リリースノート」節がありません');
const releaseNotes = notesMatch[1].trim();
if (releaseNotes.length > 500)
  throw new Error(`リリースノートが 500 字を超えています（${releaseNotes.length}）`);

console.log(`AAB   : ${path.relative(ROOT, AAB)} (${Math.round(aabStat.size / 1024 / 1024)}MB)`);
console.log(`track : ${TRACK}`);
console.log(`notes : ${releaseNotes.split('\n')[0]} …（${releaseNotes.length}字）`);

if (DRY_RUN) {
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

// ─── edits フロー ────────────────────────────────────────────────────────────
const accessToken = await getAccessToken();
const client = createEditsClient(accessToken);
const edit = await client.insert();
console.log('edit:', edit.id);

// AAB アップロード（数十 MB — application/octet-stream の media upload）
const uploadRes = await fetch(`${UPLOAD_BASE}/edits/${edit.id}/bundles?uploadType=media`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/octet-stream',
  },
  body: fs.readFileSync(AAB),
});
const bundle = await uploadRes.json().catch(() => ({}));
if (!uploadRes.ok)
  throw new Error(`bundle upload -> ${uploadRes.status} ${JSON.stringify(bundle).slice(0, 400)}`);
console.log('uploaded bundle versionCode:', bundle.versionCode);

// トラックへ割り当て（完全公開・リリースノート付き）
const trackRes = await fetch(`${API_BASE}/edits/${edit.id}/tracks/${TRACK}`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track: TRACK,
    releases: [
      {
        // 新規（未公開）アプリは draft しか作れない。draft をトラックに載せたあと、
        // Console の「公開の概要」→「変更を審査に送信」で申告一式と一緒に審査へ出す。
        // 公開済みアプリのアップデートでは 'completed' に変えること。
        status: process.argv.includes('--completed') ? 'completed' : 'draft',
        versionCodes: [String(bundle.versionCode)],
        releaseNotes: [{ language: 'ja-JP', text: releaseNotes }],
      },
    ],
  }),
});
const trackBody = await trackRes.json().catch(() => ({}));
if (!trackRes.ok)
  throw new Error(`track update -> ${trackRes.status} ${JSON.stringify(trackBody).slice(0, 400)}`);
console.log(`track ${TRACK} assigned: versionCode ${bundle.versionCode}`);

const commit = await client.commit(edit.id);
console.log('COMMITTED edit:', commit.id, '— 審査キューに入りました');
