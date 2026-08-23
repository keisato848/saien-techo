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

/** インストール・クラッシュ（Developer Reporting API）。未有効なら手順を出して続行 */
async function playReporting(pkg) {
  try {
    const token = await getAccessToken('https://www.googleapis.com/auth/playdeveloperreporting');
    // **end_date は「データ鮮度」を超えられない**（超えると 400 INVALID_ARGUMENT）。
    // 鮮度は通常 2〜3 日遅れなので、メトリクスセットから最新の freshness を読んで揃える。
    const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const meta = await (
      await fetch(
        `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${pkg}/crashRateMetricSet`,
        { headers: H },
      )
    ).json();
    const fresh = (meta.freshnessInfo?.freshnesses ?? []).find(
      (f) => f.aggregationPeriod === 'DAILY',
    )?.latestEndTime;
    const end = fresh
      ? new Date(Date.UTC(fresh.year, fresh.month - 1, fresh.day))
      : new Date(Date.now() - 3 * 86400_000);
    const start = new Date(end.getTime() - 7 * 86400_000);
    const d = (x) => ({
      year: x.getUTCFullYear(),
      month: x.getUTCMonth() + 1,
      day: x.getUTCDate(),
    });
    const r = await fetch(
      `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${pkg}/crashRateMetricSet:query`,
      {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          timelineSpec: { aggregationPeriod: 'DAILY', startTime: d(start), endTime: d(end) },
          metrics: ['crashRate', 'distinctUsers'],
        }),
      },
    );
    const j = await r.json();
    if (r.status === 403) {
      const m = /project (\d+)/.exec(j.error?.message ?? '');
      console.log(
        `  stats      取得不可: Play Developer Reporting API が未有効${m ? `（GCP project ${m[1]}）` : ''}。` +
          ' 有効化 → SA に Play Console の「アプリ情報の閲覧」権限を付与すると取れる',
      );
      return;
    }
    if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    // **行が無い = 期間中にクラッシュの報告が無い**（この API はクラッシュ/ANR 系だけで、
    // インストール数や全ユーザー数は返さない — それは Play Console の UI にしかない）
    if (!(j.rows ?? []).length) {
      console.log(
        `  stats(7d)  クラッシュの報告なし（〜${end.toISOString().slice(0, 10)}・Reporting API）。利用者数はこの API では取れない`,
      );
      return;
    }
    console.log('  stats(7d)  日付        crashRate  distinctUsers');
    for (const row of j.rows ?? []) {
      const v = Object.fromEntries(
        row.metrics.map((mm) => [mm.metric, mm.decimalValue?.value ?? mm.value ?? '-']),
      );
      console.log(
        `             ${row.startTime.year}-${String(row.startTime.month).padStart(2, '0')}-${String(row.startTime.day).padStart(2, '0')}  ${String(v.crashRate).padEnd(9)}  ${v.distinctUsers}`,
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
