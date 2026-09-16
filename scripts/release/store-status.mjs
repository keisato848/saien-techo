/**
 * 「どの版がどこに出ているか」を 1 コマンドで出す（Play / App Store）。
 *
 * 1.1 の分析（2026-08-23）で、Play は公開済みなのに ASC は 1.0 のまま、
 * だいどこは Play 1.10.1 vs ASC 1.10.2 と**両ストアの版がずれている**ことが
 * 見る場所が無いせいで気づかれていなかった。リリース手順の最初と最後で回す。
 *
 * 使い方:
 *   node scripts/release/store-status.mjs                         # このリポジトリのアプリ
 *   node scripts/release/store-status.mjs --package com.x.app --asc-app 123456  # 別アプリ
 *     （同じサービスアカウント / ASC キーに権限がある場合。識別子はベタ書きしない）
 *   node scripts/release/store-status.mjs --play-only | --asc-only
 *
 * 読むだけ。Play の edit は作って読んで削除する（commit しない）。
 *
 * Play の統計（インストール・クラッシュ）は Developer Reporting API が別で、
 * GCP プロジェクト側で有効化していないと 403 になる。その場合は有効化手順を出して続行する。
 */
import { androidPackage } from '../agent/lib/app-identity.mjs';
import { ascAppId, ascGet } from './lib/asc-api.mjs';
import { getAccessToken } from './lib/play-api.mjs';
import { getVitals, METRIC_SETS, VITALS_SCOPE } from './lib/play-vitals.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const PKG = opt('--package') ?? androidPackage();
const ASC_APP = opt('--asc-app') ?? ascAppId();
const PLAY_ONLY = args.includes('--play-only');
const ASC_ONLY = args.includes('--asc-only');

if (!ASC_ONLY) await playStatus(PKG);
if (!PLAY_ONLY) await ascStatus(ASC_APP);

// ─── Google Play ──────────────────────────────────────────────────────────────
async function playStatus(pkg) {
  const token = await getAccessToken();
  const H = { Authorization: `Bearer ${token}` };
  const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}`;
  const get = async (p, init = {}) => {
    const r = await fetch(`${base}${p}`, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${p} -> ${r.status} ${JSON.stringify(j).slice(0, 200)}`,
      );
    return j;
  };

  console.log(`\n━━ Google Play: ${pkg}`);
  const edit = await get('/edits', {
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
  try {
    const tracks = await get(`/edits/${edit.id}/tracks`);
    for (const t of tracks.tracks ?? []) {
      for (const r of t.releases ?? []) {
        console.log(
          `  ${t.track.padEnd(10)} ${String(r.status).padEnd(11)} versionCode=${(r.versionCodes ?? []).join(',').padEnd(8)} ${r.name ?? ''}`,
        );
      }
    }
    const details = await get(`/edits/${edit.id}/details`);
    console.log(
      `  listing    website=${details.contactWebsite || '（未設定 — app-ads.txt が効かない）'}`,
    );
  } finally {
    await fetch(`${base}/edits/${edit.id}`, { method: 'DELETE', headers: H });
  }

  const reviews = await get('/reviews?maxResults=5');
  const list = reviews.reviews ?? [];
  console.log(
    `  reviews    ${list.length} 件${list.length === 0 ? '（利用者が少ない可能性 — 統計で裏取りする）' : ''}`,
  );
  for (const x of list) {
    const c = x.comments?.[0]?.userComment ?? {};
    console.log(
      `    ★${c.starRating} v${c.appVersionName ?? '?'} ${(c.text ?? '').replace(/\s+/g, ' ').slice(0, 70)}`,
    );
  }

  await playReporting(pkg);
}

/**
 * Android Vitals（Developer Reporting API）。クラッシュだけを短く出す。
 * 取得の本体は lib/play-vitals.mjs に寄せてある（store-analytics.mjs と共用）。
 * 未有効・権限不足でも例外にせず、理由を 1 行出して続行する。
 */
async function playReporting(pkg) {
  try {
    const token = await getAccessToken(VITALS_SCOPE);
    const vitals = await getVitals({
      pkg,
      token,
      days: 7,
      metricSets: METRIC_SETS.filter((m) => m.id === 'crashRateMetricSet'),
    });
    const set = vitals.sets[0];
    if (!set.ok) {
      console.log(`  stats      取得不可: ${String(set.reason).slice(0, 200)}`);
      return;
    }
    // **行が無い = 期間中にクラッシュの報告が無い**（この API はクラッシュ/ANR 系だけで、
    // インストール数や全ユーザー数は返さない — それは Play Console の UI にしかない）
    if (set.rows.length === 0) {
      console.log(
        `  stats(7d)  クラッシュの報告なし（〜${vitals.end}・Reporting API）。利用者数はこの API では取れない`,
      );
      return;
    }
    console.log('  stats(7d)  日付        crashRate  distinctUsers');
    for (const row of set.rows) {
      console.log(
        `             ${row.date}  ${String(row.crashRate).padEnd(9)}  ${row.distinctUsers}`,
      );
    }
  } catch (e) {
    console.log(`  stats      取得不可: ${String(e.message ?? e).slice(0, 160)}`);
  }
}

// ─── App Store Connect ────────────────────────────────────────────────────────
async function ascStatus(appId) {
  const app = await ascGet(`/apps/${appId}?fields[apps]=name,bundleId`);
  console.log(`\n━━ App Store: ${app.data.attributes.bundleId}（${app.data.attributes.name}）`);
  const versions = await ascGet(
    `/apps/${appId}/appStoreVersions?limit=5&filter[platform]=IOS&fields[appStoreVersions]=versionString,appVersionState,createdDate`,
  );
  for (const v of versions.data) {
    console.log(
      `  version    ${v.attributes.versionString.padEnd(8)} ${v.attributes.appVersionState.padEnd(24)} created=${v.attributes.createdDate.slice(0, 10)}`,
    );
  }
  const builds = await ascGet(
    `/builds?filter[app]=${appId}&limit=5&sort=-uploadedDate&fields[builds]=version,processingState,uploadedDate`,
  );
  const linkedIds = new Set();
  for (const v of versions.data) {
    const b = (
      await ascGet(`/appStoreVersions/${v.id}/build?fields[builds]=version`).catch(() => ({}))
    ).data;
    if (b) linkedIds.add(b.id);
  }
  for (const b of builds.data) {
    const note = linkedIds.has(b.id) ? '' : '  ← どのバージョンにも紐付いていない';
    console.log(
      `  build      ${String(b.attributes.version).padEnd(8)} ${b.attributes.processingState.padEnd(10)} uploaded=${b.attributes.uploadedDate.slice(0, 16)}${note}`,
    );
  }
  const reviews = await ascGet(`/apps/${appId}/customerReviews?limit=5`).catch(() => ({
    data: [],
  }));
  console.log(`  reviews    ${reviews.data.length} 件`);
  for (const x of reviews.data)
    console.log(
      `    ★${x.attributes.rating} ${x.attributes.createdDate.slice(0, 10)} ${x.attributes.title}`,
    );
}
