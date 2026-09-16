#!/usr/bin/env node
/**
 * ストアの数字を 1 コマンドで集めて `analytics/<日付>/summary.md` に書く。
 *
 *   node scripts/release/store-analytics.mjs [--days 7] [--check-bigquery]
 *                                           [--create-asc-request] [--bigquery-project <id>]
 *                                           [--out <dir>] [--stdout] [--play-only] [--asc-only]
 *
 * **既定は読み取りのみ。** 唯一の書き込みは `--create-asc-request` で、
 * これは App Store Connect にレポート要求を作る（作成から 24〜48 時間はデータが出ない）。
 * フラグ無しでは絶対に作らない。
 *
 * 取れないものは例外にせず、理由を summary.md に残して続行する。
 * 「空欄」と「API 未有効」は別物で、後者は人の作業が要るため。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getAccessToken, PACKAGE, serviceAccountProjectId } from './lib/play-api.mjs';
import { getVitals, VITALS_SCOPE } from './lib/play-vitals.mjs';
import { ascAppId } from './lib/asc-api.mjs';
import {
  classifyAscError,
  createReportRequest,
  getEngagement,
  listReportRequests,
} from './lib/asc-analytics.mjs';
import { BIGQUERY_SCOPE, probeBigQueryExport } from './lib/bigquery-probe.mjs';
import { renderSummary } from './lib/analytics-report.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 || i + 1 >= argv.length ? fallback : argv[i + 1];
};

const DAYS = Number(opt('days', '7'));
const CHECK_BQ = flag('check-bigquery');
const CREATE_ASC = flag('create-asc-request');
const PLAY_ONLY = flag('play-only');
const ASC_ONLY = flag('asc-only');
const TO_STDOUT = flag('stdout');
const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = opt('out', path.join(ROOT, 'analytics', today));

const notes = [];

/** A 群 */
async function collectVitals() {
  try {
    const token = await getAccessToken(VITALS_SCOPE);
    return await getVitals({ pkg: PACKAGE, token, days: DAYS });
  } catch (e) {
    notes.push(`Vitals の取得で例外: ${String(e?.message ?? e).slice(0, 160)}`);
    return {
      package: PACKAGE,
      freshnessKnown: false,
      start: '-',
      end: '-',
      days: DAYS,
      sets: [{ label: '全体', ok: false, reason: String(e?.message ?? e).slice(0, 200), rows: [] }],
    };
  }
}

/** B 群 */
async function collectAsc() {
  let appId;
  try {
    appId = ascAppId();
  } catch (e) {
    notes.push(`ASC の接続情報が読めない: ${String(e?.message ?? e).slice(0, 160)}`);
    return { state: 'error', detail: String(e?.message ?? e).slice(0, 200) };
  }

  if (CREATE_ASC) {
    // **ここだけが書き込み。** 二重に作らないよう、先に既存を確認する
    try {
      const existing = await listReportRequests(appId);
      const alive = existing.filter((r) => !r?.attributes?.stoppedDueToInactivity);
      if (alive.length > 0) {
        console.log(`  asc        レポート要求は既にあります（id=${alive[0].id}）。作成はしません`);
        notes.push('--create-asc-request が渡されたが、有効な要求が既にあったので作成しなかった');
      } else {
        const created = await createReportRequest(appId, 'ONGOING');
        console.log(`  asc        レポート要求を作成しました: id=${created?.id ?? '不明'}`);
        notes.push(
          `App Store Connect にレポート要求を作成した（id=${created?.id ?? '不明'}）。データが出るまで 24〜48 時間かかる`,
        );
      }
    } catch (e) {
      notes.push(`レポート要求の作成に失敗: ${String(e?.message ?? e).slice(0, 160)}`);
    }
  }

  try {
    return await getEngagement({ appId });
  } catch (e) {
    return classifyAscError(e?.message ?? e);
  }
}

/** B' 群 */
async function collectBigQuery() {
  try {
    const projectId = opt('bigquery-project') ?? serviceAccountProjectId();
    const token = await getAccessToken(BIGQUERY_SCOPE);
    return await probeBigQueryExport({ projectId, token });
  } catch (e) {
    return { state: 'error', detail: String(e?.message ?? e).slice(0, 200), matches: [] };
  }
}

async function main() {
  console.log(
    `━━ ストアの数字を集めます（${today}・直近 ${Number.isFinite(DAYS) && DAYS >= 1 ? Math.floor(DAYS) : 7} 日）`,
  );

  const vitals = ASC_ONLY ? null : await collectVitals();
  if (vitals)
    console.log(
      `  play       Vitals ${vitals.sets.filter((s) => s.ok).length}/${vitals.sets.length} セット取得`,
    );

  const asc = PLAY_ONLY ? null : await collectAsc();
  if (asc) console.log(`  asc        ${asc.state}${asc.detail ? `: ${asc.detail}` : ''}`);

  const bigquery = CHECK_BQ ? await collectBigQuery() : null;
  if (bigquery) console.log(`  bigquery   ${bigquery.state}: ${bigquery.detail}`);
  else notes.push('BigQuery エクスポートの判定は実行していない（--check-bigquery で判定する）');

  if (!CREATE_ASC && asc?.state === 'no-request')
    notes.push(
      'ASC のレポート要求が無い。--create-asc-request を付けると作成する（App Store Connect への書き込み）',
    );

  const md = renderSummary({ date: today, vitals, asc, bigquery, notes });

  if (TO_STDOUT) {
    process.stdout.write(md);
    return;
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outFile = path.join(OUT_DIR, 'summary.md');
  fs.writeFileSync(outFile, md, 'utf8');
  console.log(`\n書き出しました: ${path.relative(ROOT, outFile)}`);
}

main().catch((e) => {
  console.error(`失敗: ${String(e?.message ?? e).slice(0, 400)}`);
  process.exit(1);
});
