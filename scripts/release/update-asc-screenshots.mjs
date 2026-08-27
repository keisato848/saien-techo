/**
 * App Store Connect のスクリーンショット（ja / iPhone 6.9"）を
 * `docs/store/app-store/store-slides/` の内容で差し替える。
 *
 * `update-play-screenshots.mjs` の App Store 版。**上げるのは素のキャプチャではなく、
 * キャプション入りのスライド**（`compose-store-slides.mjs --ios` の出力）。
 * 素のキャプチャは `docs/store/app-store/phone-screenshots/`。
 *
 * これまで ASC への反映だけ手作業（I8 の「Windows 側が受け取って ASC へ上げる」）で、
 * 口が無かったため **#160 のキャプション版がどのストアにも出ていなかった**。
 *
 * ## 触るのは「準備中のバージョン」だけ
 *
 * 公開済み・審査中のバージョンのスクショは変えられない（API も拒否する）。
 * **先に `submit-asc-version.mjs` でバージョンページを作ること。**
 * 新バージョンは前バージョンのスクショを引き継ぐので、ここでは
 * **既存を消してから順に上げ直す**（アップロード順が表示順になる）。
 *
 * ## アップロードの手順（ASC の作法）
 *
 * 1. `POST /appScreenshots`（fileName / fileSize と set への紐付け）
 *    → 返ってきた `uploadOperations` が「どこへ何バイト送るか」を持つ
 * 2. 各 operation のとおりに **ASC ではなく指定 URL へ** PUT する（認証ヘッダも指定どおり）
 * 3. `PATCH /appScreenshots/{id}` に `uploaded: true` と **MD5** を送って確定
 * 4. `assetDeliveryState` が COMPLETE になるまで待つ。FAILED なら理由を出して落とす
 *
 * 使い方:
 *   node scripts/release/update-asc-screenshots.mjs --dry-run
 *   node scripts/release/update-asc-screenshots.mjs
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { appIdentity } from '../agent/lib/app-identity.mjs';
import { ascAppId, ascDelete, ascGet, ascPatch, ascPost } from './lib/asc-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SHOTS_DIR = path.join(ROOT, 'docs/store/app-store/store-slides');
const LOCALE = 'ja';
/** iPhone 6.9"（1320x2868）。ASC の表示種別は 6.7" 系と同じ枠を使う */
const DISPLAY_TYPE = 'APP_IPHONE_67';
const EXPECTED = { width: 1320, height: 2868 };
const DRY_RUN = process.argv.includes('--dry-run');

/** 触ってよいのは準備中の状態だけ（submit-asc-version.mjs と同じ判断） */
const EDITABLE_STATES = new Set(['PREPARE_FOR_SUBMISSION', 'DEVELOPER_REJECTED', 'REJECTED']);

/**
 * 表示順。**`compose-store-slides.mjs` の SLIDES と同じ順**にする
 * （ファイル名の番号は撮影順で、表示順とは一致しない）。
 * ここに書いたのに実体が無いものは**黙って飛ばさず、落としたことを出す**。
 */
const ORDER = [
  '01-home.png',
  '02-plantings.png',
  '03-planting-detail.png',
  '04-harvests.png',
  '08-harvest-reads.png',
  '05-crop-guide.png',
  '06-calendar.png',
  '07-materials.png',
];

// ─── 検証（存在・PNG・寸法・10 枚以内） ──────────────────────────────────────
const missing = ORDER.filter((f) => !fs.existsSync(path.join(SHOTS_DIR, f)));
const plan = ORDER.filter((f) => !missing.includes(f)).map((file) => {
  const p = path.join(SHOTS_DIR, file);
  const b = fs.readFileSync(p);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`not PNG: ${file}`);
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (width !== EXPECTED.width || height !== EXPECTED.height) {
    throw new Error(
      `寸法が ${DISPLAY_TYPE} の要件外: ${file} ${width}x${height}` +
        `（期待 ${EXPECTED.width}x${EXPECTED.height}）`,
    );
  }
  return { file, path: p, bytes: b.length, dims: `${width}x${height}` };
});

if (plan.length === 0) throw new Error(`アップロードできる PNG がありません: ${SHOTS_DIR}`);
if (plan.length > 10) throw new Error(`App Store のスクショは最大 10 枚（現在 ${plan.length}）`);

const { version } = appIdentity();
console.log(`plan (${plan.length} files, ${LOCALE}/${DISPLAY_TYPE}, app version ${version}):`);
for (const [i, s] of plan.entries())
  console.log(`  ${i + 1}. ${s.file} ${s.dims} ${Math.round(s.bytes / 1024)}KB`);
if (missing.length > 0) {
  // 黙って減らさない。**枚数が減ったことに気づけないまま掲載される**のを防ぐ
  console.log(`  ⚠ ORDER にあるが実体が無く、飛ばしたもの: ${missing.join(', ')}`);
}

// ─── 差し替え先（準備中バージョンの ja ローカライズ）を特定 ───────────────────
const appId = ascAppId();
const versions = await ascGet(
  `/apps/${appId}/appStoreVersions?limit=10` +
    `&fields[appStoreVersions]=versionString,appStoreState,platform`,
);
const target = versions.data.find(
  (v) => v.attributes.versionString === version && EDITABLE_STATES.has(v.attributes.appStoreState),
);
if (!target) {
  const seen = versions.data
    .map((v) => `${v.attributes.versionString}(${v.attributes.appStoreState})`)
    .join(', ');
  throw new Error(
    `編集できる ${version} のバージョンページがありません。` +
      `先に submit-asc-version.mjs を実行してください。現状: ${seen}`,
  );
}
console.log(`\ntarget: ${target.attributes.versionString} (${target.attributes.appStoreState})`);

const locs = await ascGet(
  `/appStoreVersions/${target.id}/appStoreVersionLocalizations` +
    `?fields[appStoreVersionLocalizations]=locale`,
);
const loc = locs.data.find((l) => l.attributes.locale === LOCALE);
if (!loc) throw new Error(`${LOCALE} のローカライズがありません`);

const sets = await ascGet(
  `/appStoreVersionLocalizations/${loc.id}/appScreenshotSets` +
    `?fields[appScreenshotSets]=screenshotDisplayType`,
);
let set = sets.data.find((s) => s.attributes.screenshotDisplayType === DISPLAY_TYPE);

const existing = set
  ? (
      await ascGet(
        `/appScreenshotSets/${set.id}/appScreenshots?limit=20&fields[appScreenshots]=fileName`,
      )
    ).data
  : [];
console.log(
  `既存: ${set ? `${DISPLAY_TYPE} セットあり・${existing.length} 枚` : `${DISPLAY_TYPE} セット無し`}`,
);
for (const s of existing) console.log(`  - ${s.attributes.fileName}`);

if (DRY_RUN) {
  console.log('\nDRY RUN: 変更していません');
  process.exit(0);
}

// ─── 既存を消す → 順に上げる ────────────────────────────────────────────────
if (!set) {
  const created = await ascPost('/appScreenshotSets', {
    data: {
      type: 'appScreenshotSets',
      attributes: { screenshotDisplayType: DISPLAY_TYPE },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: 'appStoreVersionLocalizations', id: loc.id },
        },
      },
    },
  });
  set = created.data;
  console.log(`created set: ${set.id}`);
}

for (const s of existing) {
  await ascDelete(`/appScreenshots/${s.id}`);
  console.log(`deleted: ${s.attributes.fileName}`);
}

/** 1 枚上げる。予約 → uploadOperations のとおりに送る → MD5 で確定 */
async function upload({ file, path: filePath, bytes }) {
  const buffer = fs.readFileSync(filePath);
  const reserved = await ascPost('/appScreenshots', {
    data: {
      type: 'appScreenshots',
      attributes: { fileName: file, fileSize: bytes },
      relationships: { appScreenshotSet: { data: { type: 'appScreenshotSets', id: set.id } } },
    },
  });
  const id = reserved.data.id;
  const operations = reserved.data.attributes.uploadOperations ?? [];
  if (operations.length === 0) throw new Error(`${file}: uploadOperations が空`);

  for (const op of operations) {
    const headers = Object.fromEntries((op.requestHeaders ?? []).map((h) => [h.name, h.value]));
    const chunk = buffer.subarray(op.offset, op.offset + op.length);
    const res = await fetch(op.url, { method: op.method, headers, body: chunk });
    if (!res.ok) {
      throw new Error(`${file}: chunk ${op.offset}+${op.length} -> ${res.status}`);
    }
  }

  await ascPatch(`/appScreenshots/${id}`, {
    data: {
      type: 'appScreenshots',
      id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto.createHash('md5').update(buffer).digest('hex'),
      },
    },
  });
  return id;
}

/**
 * 反映は非同期。**「PATCH が通った」で終わりにしない** — 以前 Android 側で
 * 「コマンドが成功したか」しか見ずに壊れた成果物を PASS と報告した実績がある。
 */
async function waitForDelivery(id, file) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const got = await ascGet(`/appScreenshots/${id}?fields[appScreenshots]=assetDeliveryState`);
    const state = got.data.attributes.assetDeliveryState ?? {};
    if (state.state === 'COMPLETE') return;
    if (state.state === 'FAILED') {
      throw new Error(`${file}: 反映に失敗 ${JSON.stringify(state.errors ?? state)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`${file}: 反映が COMPLETE になりませんでした（60 秒待機）`);
}

const uploadedIds = [];
for (const [index, shot] of plan.entries()) {
  const id = await upload(shot);
  await waitForDelivery(id, shot.file);
  uploadedIds.push(id);
  console.log(`uploaded ${index + 1}/${plan.length}: ${shot.file}`);
}

// アップロード順が表示順になるが、念のため明示的に並べ直す
await ascPatch(`/appScreenshotSets/${set.id}/relationships/appScreenshots`, {
  data: uploadedIds.map((id) => ({ type: 'appScreenshots', id })),
});

console.log(`\nDONE: ${plan.length} 枚を ${LOCALE}/${DISPLAY_TYPE} へ反映しました`);
console.log('審査への提出は submit-asc-version.mjs --submit（外向き — 承認を得てから）');
