#!/usr/bin/env node
/**
 * Play Console の月次レポート CSV を、ログイン済みブラウザで落として保存する。
 *
 *   node scripts/release/fetch-play-reports.mjs [--months 3] [--out <dir>] [--login] [--headed]
 *
 * **なぜブラウザなのか。** Play の統計は API では取れない:
 *   - Play Developer Reporting API は Vitals のみ（インストール数は対象外）
 *   - レポート用の Cloud Storage バケットは **Google 所有**で、サービスアカウントに
 *     権限を足せない（2026-09-17 に 403 を実測）
 *   - 残る正規の道は BigQuery Data Transfer だが、設定と課金が要る
 * ログイン済みブラウザからなら直リンクでそのまま落とせるので、それを使う。
 *
 * **保存するのは CSV だけ。** 集計と Markdown 化は store-analytics.mjs が行う。
 *
 * セッションは `--profile`（既定 C:/secure/play-console-profile）に残る。
 * **この中に Google のログイン情報が入る**ので、鍵と同じ場所に置きリポジトリには入れない。
 * 切れたら `--login` で開き直す（そのときだけ画面が出る）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { androidPackage } from '../agent/lib/app-identity.mjs';
import {
  classifyMissing,
  decodeCsv,
  recentMonths,
  REPORTS,
  reportUrl,
} from './lib/play-reports.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d = null) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 || i + 1 >= argv.length ? d : argv[i + 1];
};

const DEV_ID = opt('developer', process.env.PLAY_DEVELOPER_ID ?? null);
const CONSOLE_APP_ID = opt('console-app', process.env.PLAY_CONSOLE_APP_ID ?? null);
const PROFILE = opt(
  'profile',
  process.env.PLAY_CONSOLE_PROFILE ?? 'C:/secure/play-console-profile',
);
const OUT = path.resolve(ROOT, opt('out', 'analytics/play-reports'));
const MONTHS = recentMonths(opt('months', '3'));
const LOGIN = flag('login');
const HEADED = flag('headed') || LOGIN;
const PKG = androidPackage();

if (!DEV_ID) {
  console.error(
    '失敗: デベロッパー ID がありません。Play Console の URL（/developers/<ここ>/）の数字を\n' +
      '      --developer か環境変数 PLAY_DEVELOPER_ID で渡してください',
  );
  process.exit(1);
}

let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  console.error(
    '失敗: playwright-core が入っていません。`pnpm install` を実行してください\n' +
      '      （既定では端末の Chrome を使うので、ブラウザのダウンロードは発生しません）',
  );
  process.exit(1);
}

const onConsole = (raw) => {
  try {
    const u = new URL(raw);
    return u.hostname === 'play.google.com' && u.pathname.startsWith('/console');
  } catch {
    return false;
  }
};

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(PROFILE, { recursive: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome',
  headless: !HEADED,
  viewport: { width: 1440, height: 1000 },
  args: ['--disable-blink-features=AutomationControlled'],
});

try {
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  const home = `https://play.google.com/console/u/0/developers/${DEV_ID}/app-list`;
  await page.goto(home, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);

  if (!onConsole(page.url())) {
    if (!LOGIN) {
      console.error(
        '失敗: Play Console にログインできていません（現在地: ' +
          page.url().slice(0, 80) +
          '）\n      `--login` を付けて実行すると画面が開くので、そこでログインしてください',
      );
      process.exitCode = 1;
      throw new Error('not-logged-in');
    }
    console.log('ログイン画面を開きます。ブラウザで操作してください（最大 15 分）');
    await page.goto(
      'https://accounts.google.com/ServiceLogin?continue=' + encodeURIComponent(home),
      { waitUntil: 'domcontentloaded', timeout: 60000 },
    );
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline && !onConsole(page.url())) await page.waitForTimeout(5000);
    if (!onConsole(page.url())) throw new Error('ログインが完了しませんでした');
    console.log('ログインできました。');
  }
  if (CONSOLE_APP_ID) {
    // 画面を 1 度開いておくと、ストレージ側の cookie が確実になる
    await page
      .goto(
        `https://play.google.com/console/u/0/developers/${DEV_ID}/download-reports/statistics?appId=${CONSOLE_APP_ID}`,
        { waitUntil: 'domcontentloaded', timeout: 60000 },
      )
      .catch(() => {});
    await page.waitForTimeout(4000);
  }

  console.log(`対象: ${PKG} / 月: ${MONTHS.join(', ')}`);
  let saved = 0;
  const notes = [];
  const pending = [];
  for (const month of MONTHS) {
    const okKinds = [];
    const failedKinds = [];
    for (const r of REPORTS) {
      const url = reportUrl({ developerId: DEV_ID, packageName: PKG, ...r, month });
      const res = await ctx.request.get(url, { timeout: 60000 }).catch((e) => ({ err: e }));
      const name = `${r.group}_${PKG}_${month}_${r.kind}.csv`;
      if (res.err || !res.ok()) {
        failedKinds.push(`${r.group}/${r.kind}`);
        continue;
      }
      const buf = Buffer.from(await res.body());
      // **403 の本文が HTML で 200 に化けることがある**ので中身で確かめる
      if (!decodeCsv(buf).startsWith('Date')) {
        failedKinds.push(`${r.group}/${r.kind}(CSV でない)`);
        continue;
      }
      fs.writeFileSync(path.join(OUT, name), buf);
      okKinds.push(`${r.group}/${r.kind}`);
      saved += 1;
    }
    console.log(`  ${month}: 取得 ${okKinds.length} / 失敗 ${failedKinds.length}`);
    if (failedKinds.length > 0) pending.push({ month, failedKinds, okKindsSameMonth: okKinds });
  }

  // **判定は全月を見てから。** 他の月が取れていればセッションは生きている
  for (const p of pending) notes.push(classifyMissing({ ...p, anySuccessInRun: saved > 0 }));
  for (const n of notes) console.log(`  - ${n}`);
  console.log(`\n保存 ${saved} 件: ${path.relative(ROOT, OUT)}`);
  if (saved === 0) process.exitCode = 1;
} catch (e) {
  if (String(e?.message) !== 'not-logged-in')
    console.error(`失敗: ${String(e?.message ?? e).slice(0, 300)}`);
  process.exitCode = 1;
} finally {
  await ctx.close().catch(() => {});
}
