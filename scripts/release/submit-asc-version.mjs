/**
 * App Store Connect に「バージョンページを作る → ビルドを紐付ける → What's New を入れる →
 * 審査に提出する」を API で行う（1.1 リリース・2026-08-23 の実績を固定化）。
 *
 * **`eas submit` はバイナリを上げるだけ**で、審査には入らない。1.1 では両アプリとも
 * 「アップロード止まり」のまま気づかれていなかった（さいえん手帳 build 5・だいどこ 10027）。
 * UI でやる工程は抜ける。ここで機械化する。
 *
 * 使い方（eas submit の後に）:
 *   node scripts/release/submit-asc-version.mjs --dry-run   # 何をするかだけ表示
 *   node scripts/release/submit-asc-version.mjs             # バージョン作成・ビルド紐付け・What's New まで
 *   node scripts/release/submit-asc-version.mjs --submit    # ↑に加えて審査へ提出（外向き — 承認を得てから）
 *
 * 単一ソース:
 *   - バージョン / ビルド番号: apps/mobile/app.json（expo.version / expo.ios.buildNumber）
 *   - What's New: docs/store/app-store/listing-ja.md §6 の `### v<version>` 配下
 *   - 接続情報: apps/mobile/eas.json submit.production.ios（lib/asc-api.mjs）
 *
 * 冪等: 既に同じバージョンがあれば再利用する。**審査中・公開済みのバージョンには触らない**
 * （紐付け直すと提出が壊れる）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appIdentity } from '../agent/lib/app-identity.mjs';
import { ascAppId, ascGet, ascPatch, ascPost } from './lib/asc-api.mjs';
import { parseWhatsNew, WHATS_NEW_MAX } from './lib/store-listing.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LISTING = path.join(ROOT, 'docs/store/app-store/listing-ja.md');

const DRY_RUN = process.argv.includes('--dry-run');
const SUBMIT = process.argv.includes('--submit');
const LOCALE = 'ja';

/** 触ってよいのは準備中の状態だけ。これ以外は「もう動いている」ので止める */
const EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED']);

const { version, iosBuildNumber } = appIdentity();
const APP = ascAppId();

const md = fs.readFileSync(LISTING, 'utf8');
const whatsNew = parseWhatsNew(md, version);
if (!whatsNew) throw new Error(`listing-ja.md §6 に「### v${version}」の What's New がありません`);
if (whatsNew.length > WHATS_NEW_MAX)
  throw new Error(`What's New が ${WHATS_NEW_MAX} 字を超えています`);

console.log(`app      : ${APP}`);
console.log(`version  : ${version}  build: ${iosBuildNumber}`);
console.log(`whatsNew : ${whatsNew.split('\n')[0]} …（${whatsNew.length}字）`);

// ─── 1) バージョン ─────────────────────────────────────────────────────────────
const existing = (
  await ascGet(
    `/apps/${APP}/appStoreVersions?filter[versionString]=${encodeURIComponent(version)}&filter[platform]=IOS&fields[appStoreVersions]=versionString,appVersionState`,
  )
).data[0];

if (existing && !EDITABLE_STATES.has(existing.attributes.appVersionState)) {
  console.log(`version  : ${version} は既に ${existing.attributes.appVersionState} — 触りません`);
  process.exit(0);
}

// ─── 2) ビルド ─────────────────────────────────────────────────────────────────
const build = (
  await ascGet(
    `/builds?filter[app]=${APP}&filter[version]=${iosBuildNumber}&fields[builds]=version,processingState,uploadedDate`,
  )
).data[0];
if (!build)
  throw new Error(
    `build ${iosBuildNumber} が ASC にありません（eas submit が済んでいるか・処理中か）`,
  );
if (build.attributes.processingState !== 'VALID') {
  throw new Error(
    `build ${iosBuildNumber} は ${build.attributes.processingState}（処理完了まで待つ）`,
  );
}
console.log(
  `build    : ${build.attributes.version} ${build.attributes.processingState} (${build.attributes.uploadedDate.slice(0, 16)})`,
);

if (DRY_RUN) {
  console.log(
    existing
      ? `plan     : 既存 ${version}（${existing.attributes.appVersionState}）に紐付け直す`
      : `plan     : ${version} を新規作成`,
  );
  console.log(
    `plan     : build ${iosBuildNumber} を紐付け → What's New(${LOCALE}) 設定${SUBMIT ? ' → 審査提出' : ''}`,
  );
  console.log('--- dry-run: 送信せず終了 ---');
  process.exit(0);
}

const ver =
  existing ??
  (
    await ascPost('/appStoreVersions', {
      data: {
        type: 'appStoreVersions',
        attributes: { platform: 'IOS', versionString: version },
        relationships: { app: { data: { type: 'apps', id: APP } } },
      },
    })
  ).data;
console.log(existing ? `version  : 既存を再利用 ${ver.id}` : `version  : 作成 ${ver.id}`);

await ascPatch(`/appStoreVersions/${ver.id}/relationships/build`, {
  data: { type: 'builds', id: build.id },
});

// ─── 3) What's New ────────────────────────────────────────────────────────────
const locs = (
  await ascGet(
    `/appStoreVersions/${ver.id}/appStoreVersionLocalizations?fields[appStoreVersionLocalizations]=locale`,
  )
).data;
const loc = locs.find((l) => l.attributes.locale === LOCALE);
if (!loc)
  throw new Error(
    `localization ${LOCALE} がありません（ある: ${locs.map((l) => l.attributes.locale).join(', ')}）`,
  );
await ascPatch(`/appStoreVersionLocalizations/${loc.id}`, {
  data: { type: 'appStoreVersionLocalizations', id: loc.id, attributes: { whatsNew } },
});

// ─── 4) 紐付けを実物で確認（relationship の PATCH は 204 で中身を返さない） ───
const linked = (await ascGet(`/appStoreVersions/${ver.id}/build?fields[builds]=version`)).data;
if (!linked || linked.id !== build.id) throw new Error('ビルドの紐付けを確認できませんでした');
console.log(`linked   : build ${linked.attributes.version} ✔   whatsNew ✔`);

if (!SUBMIT) {
  console.log('--- 準備まで。審査へ出すには --submit（ユーザー承認を得てから）---');
  process.exit(0);
}

// ─── 5) 審査提出（Review Submissions API） ────────────────────────────────────
const rs = (
  await ascPost('/reviewSubmissions', {
    data: {
      type: 'reviewSubmissions',
      attributes: { platform: 'IOS' },
      relationships: { app: { data: { type: 'apps', id: APP } } },
    },
  })
).data;
await ascPost('/reviewSubmissionItems', {
  data: {
    type: 'reviewSubmissionItems',
    relationships: {
      reviewSubmission: { data: { type: 'reviewSubmissions', id: rs.id } },
      appStoreVersion: { data: { type: 'appStoreVersions', id: ver.id } },
    },
  },
});
const done = (
  await ascPatch(`/reviewSubmissions/${rs.id}`, {
    data: { type: 'reviewSubmissions', id: rs.id, attributes: { submitted: true } },
  })
).data;
console.log(`SUBMITTED: reviewSubmission ${rs.id} state=${done.attributes.state}`);
