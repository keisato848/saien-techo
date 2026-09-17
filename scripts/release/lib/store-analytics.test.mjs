/**
 * ストア指標の集計まわりの純粋関数。実行: `pnpm test:scripts`（node --test）。
 *
 * 狙いは「壊れた入力で落ちないこと」。この 3 つは外部 API の返り値が入口なので、
 * 列名の改称・空レスポンス・数値でない値が普通に来る。**歯のあるテストにするため、
 * 正常系だけでなく壊れた入力を必ず 1 件ずつ入れてある。**
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  dailyFreshness,
  foldRow,
  forbiddenReason,
  isApiDisabled,
  METRIC_SETS,
  projectFromForbidden,
  resolveRange,
  ymd,
  ymdToIso,
} from './play-vitals.mjs';
import {
  classifyAscError,
  detectDelimiter,
  findColumn,
  parseDelimited,
  pickReport,
  summarizeBySource,
  toNumber,
  WANTED_REPORTS,
} from './asc-analytics.mjs';
import { classify, looksLikePlayTable } from './bigquery-probe.mjs';
import { asPercent, cell, mdTable, renderSummary } from './analytics-report.mjs';

/* ---------------- play-vitals ---------------- */

test('ymd は UTC で年月日を返し、Date でなければ投げる', () => {
  assert.deepEqual(ymd(new Date(Date.UTC(2026, 8, 16))), { year: 2026, month: 9, day: 16 });
  assert.throws(() => ymd('2026-09-16'), TypeError);
  assert.throws(() => ymd(new Date('壊れた')), TypeError);
});

test('ymdToIso は欠けた値を - にする', () => {
  assert.equal(ymdToIso({ year: 2026, month: 9, day: 1 }), '2026-09-01');
  assert.equal(ymdToIso({ year: 2026, month: 9 }), '-');
  assert.equal(ymdToIso(null), '-');
  assert.equal(ymdToIso('文字列'), '-');
});

test('dailyFreshness は DAILY だけを拾い、無ければ null', () => {
  const body = {
    freshnessInfo: {
      freshnesses: [
        { aggregationPeriod: 'HOURLY', latestEndTime: { year: 2026, month: 9, day: 16 } },
        { aggregationPeriod: 'DAILY', latestEndTime: { year: 2026, month: 9, day: 13 } },
      ],
    },
  };
  assert.equal(dailyFreshness(body).toISOString().slice(0, 10), '2026-09-13');
  assert.equal(dailyFreshness({}), null);
  assert.equal(dailyFreshness(null), null);
  // DAILY はあるが日付が欠けている（API が部分的に壊れた形）
  assert.equal(
    dailyFreshness({ freshnessInfo: { freshnesses: [{ aggregationPeriod: 'DAILY' }] } }),
    null,
  );
});

test('resolveRange は鮮度が無ければ 3 日前を終端にし、不正な days を 7 に丸める', () => {
  const now = new Date(Date.UTC(2026, 8, 16));
  const fresh = new Date(Date.UTC(2026, 8, 13));

  const a = resolveRange(fresh, 7, now);
  assert.equal(a.end.toISOString().slice(0, 10), '2026-09-13');
  assert.equal(a.start.toISOString().slice(0, 10), '2026-09-06');
  assert.equal(a.days, 7);

  const b = resolveRange(null, 30, now);
  assert.equal(b.end.toISOString().slice(0, 10), '2026-09-13');
  assert.equal(b.days, 30);

  // --days に何が来ても 400 を生む値にしない
  for (const bad of ['abc', 0, -5, undefined, null, NaN]) {
    assert.equal(resolveRange(fresh, bad, now).days, 7, `days=${String(bad)}`);
  }
  assert.equal(resolveRange(fresh, 10.9, now).days, 10);
});

test('foldRow は decimalValue と value の両方を拾い、壊れた行でも落ちない', () => {
  const row = {
    startTime: { year: 2026, month: 9, day: 10 },
    metrics: [
      { metric: 'crashRate', decimalValue: { value: '0.0123' } },
      { metric: 'distinctUsers', value: '42' },
      { decimalValue: { value: '無視される' } },
    ],
  };
  assert.deepEqual(foldRow(row), { date: '2026-09-10', crashRate: '0.0123', distinctUsers: '42' });
  assert.deepEqual(foldRow({}), { date: '-' });
  assert.deepEqual(foldRow(null), { date: '-' });
  assert.deepEqual(
    foldRow({ startTime: { year: 2026, month: 9, day: 1 }, metrics: [{ metric: 'x' }] }),
    {
      date: '2026-09-01',
      x: '-',
    },
  );
});

test('foldRow はディメンションを 1 列にまとめ、valueLabel を優先する', () => {
  const row = {
    startTime: { year: 2026, month: 9, day: 10 },
    dimensions: [
      { dimension: 'startType', stringValue: 'COLD', valueLabel: 'コールド起動' },
      { dimension: 'versionCode', int64Value: '5' },
      { stringValue: '無視される' },
    ],
    metrics: [{ metric: 'slowStartRate', decimalValue: { value: '0.2' } }],
  };
  assert.equal(foldRow(row).dimension, 'コールド起動 / 5');
  // ディメンションが無い行には dimension を生やさない（表に空列を作らないため）
  assert.equal('dimension' in foldRow({ metrics: [] }), false);
});

test('projectFromForbidden は本文からプロジェクト番号を拾う', () => {
  assert.equal(projectFromForbidden('... is disabled for project 123456789 ...'), '123456789');
  assert.equal(projectFromForbidden('権限がありません'), null);
  assert.equal(projectFromForbidden(undefined), null);
});

test('403 を「API 未有効」と決めつけない（ゲーム専用セットの実測 403 を取り違えない）', () => {
  // 2026-09-16 に実際に返ってきた本文
  const gamesOnly = 'slowRenderingRateMetricSet resource is only accessible to games';
  assert.equal(isApiDisabled(gamesOnly), false);
  const reason = forbiddenReason(gamesOnly);
  assert.match(reason, /only accessible to games/);
  assert.equal(/未有効/.test(reason), false, '直さなくてよい設定を直しに行かせない');

  const disabled =
    'Play Developer Reporting API has not been used in project 123456789 before or it is disabled.';
  assert.equal(isApiDisabled(disabled), true);
  assert.match(forbiddenReason(disabled), /未有効/);
  assert.match(forbiddenReason(disabled), /project=123456789/);

  assert.match(forbiddenReason(undefined), /理由の記載なし/);
});

test('METRIC_SETS は実測で確定した名前と必須ディメンションを保つ', () => {
  const byId = Object.fromEntries(METRIC_SETS.map((s) => [s.id, s]));
  // セット名から素直に綴ると 400 になる方（stuckBackgroundWakelock → stuckBgWakelockRate）
  assert.ok(byId.stuckBackgroundWakelockRateMetricSet.metrics.includes('stuckBgWakelockRate'));
  // startType を落とすと 400
  assert.deepEqual(byId.slowStartRateMetricSet.dimensions, ['startType']);
  // ゲーム専用セットは既定に入れない
  assert.equal(byId.slowRenderingRateMetricSet, undefined);
  for (const s of METRIC_SETS) assert.ok(s.metrics.includes('distinctUsers'), s.id);
});

/* ---------------- asc-analytics ---------------- */

test('detectDelimiter はタブ優先、カンマの方が多ければカンマ', () => {
  assert.equal(detectDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter(''), '\t');
  assert.equal(detectDelimiter(null), '\t');
});

test('parseDelimited は BOM を落とし、列数がずれた行も空で埋める', () => {
  const rows = parseDelimited(
    '﻿Date\tSource Type\tCounts\n2026-09-10\t検索\t100\n2026-09-11\t閲覧',
  );
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { Date: '2026-09-10', 'Source Type': '検索', Counts: '100' });
  assert.equal(rows[1].Counts, '', '欠けた列は空文字で埋まる');
  // ヘッダだけ／空は空配列
  assert.deepEqual(parseDelimited('Date\tCounts'), []);
  assert.deepEqual(parseDelimited(''), []);
  assert.deepEqual(parseDelimited(null), []);
});

test('findColumn は記号と大小を無視して緩く一致する', () => {
  const header = ['Date', 'Source Type', 'Unique Counts'];
  assert.equal(findColumn(header, 'Source Type'), 'Source Type');
  assert.equal(findColumn(header, 'sourcetype'), 'Source Type');
  assert.equal(findColumn(header, 'Counts'), 'Unique Counts', '部分一致に落ちる');
  assert.equal(findColumn(header, '存在しない'), null);
});

test('toNumber は桁区切りを外し、数値でなければ 0', () => {
  assert.equal(toNumber('1,234'), 1234);
  assert.equal(toNumber('2 913'), 2913);
  assert.equal(toNumber('-'), 0);
  assert.equal(toNumber(undefined), 0);
});

test('summarizeBySource はソース別に合計し、列名が違えば ok=false で実列名を返す', () => {
  const rows = [
    {
      Date: '2026-09-10',
      'Source Type': 'App Store Search',
      'Engagement Type': 'Impression',
      Counts: '2,000',
    },
    {
      Date: '2026-09-11',
      'Source Type': 'App Store Search',
      'Engagement Type': 'Impression',
      Counts: '913',
    },
    {
      Date: '2026-09-11',
      'Source Type': 'App Referrer',
      'Engagement Type': 'Impression',
      Counts: '6',
    },
  ];
  const s = summarizeBySource(rows);
  assert.equal(s.ok, true);
  assert.deepEqual(s.rows[0], { source: 'App Store Search', kind: 'Impression', value: 2913 });
  assert.equal(s.rows[1].value, 6);

  // 列名が変わったら憶測で 0 を並べず、実際の列名を返す
  const bad = summarizeBySource([{ 日付: '2026-09-10', なにか: '1' }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.header, ['日付', 'なにか']);

  assert.equal(summarizeBySource([]).ok, false);
  assert.equal(summarizeBySource(null).ok, false);
});

test('pickReport は Detailed を Standard より先に選ぶ', () => {
  // 実際の一覧では同じ名前に Standard と Detailed が並ぶ（2026-09-17 取得）
  const reports = [
    { id: '1', attributes: { name: 'App Store Discovery and Engagement Standard' } },
    { id: '2', attributes: { name: 'App Store Discovery and Engagement Detailed' } },
  ];
  const want = WANTED_REPORTS.find((w) => w.key === 'engagement').preferred;
  assert.equal(pickReport(reports, want).id, '2', '部分一致で Standard を掴まない');
  // Detailed が無ければ Standard へ落ちる
  assert.equal(pickReport([reports[0]], want).id, '1');
});

test('pickReport は当たらなければ null（先頭で妥協しない）', () => {
  // 実際の一覧は 50 件中 37 件が AirPlay・Metal 等の無関係なレポート。
  // 先頭を返すと「表示回数」の表に AirPlay の数字が載る
  const noise = [
    { id: '9', attributes: { name: 'AirPlay Discovery Sessions' } },
    { id: '10', attributes: { name: 'Metal Command Queues' } },
  ];
  for (const w of WANTED_REPORTS) assert.equal(pickReport(noise, w.preferred), null, w.key);
  assert.equal(pickReport([]), null);
  assert.equal(pickReport(null), null);
  assert.equal(pickReport([{ id: '3' }]), null, 'attributes が無くても落ちず、拾いもしない');
});

test('WANTED_REPORTS は 1 レポートに寄せず、表示回数とダウンロードを別々に取りに行く', () => {
  const keys = WANTED_REPORTS.map((w) => w.key);
  assert.ok(keys.includes('engagement'), '表示回数・製品ページ閲覧数');
  assert.ok(keys.includes('downloads'), '初回ダウンロード数は別レポート');
  for (const w of WANTED_REPORTS) {
    assert.ok(w.preferred.length >= 1, w.key);
    assert.match(w.preferred[0], /Detailed$/, `${w.key}: Detailed を先頭に置く`);
  }
});

test('classifyAscError は鍵の権限不足を、生 JSON ではなく次の行動に翻訳する', () => {
  // 2026-09-16 に実際に返ってきた本文
  const keyDenied =
    'GET /apps/123/analyticsReportRequests -> 403 {"detail":"The API key in use does not allow this request"}';
  const a = classifyAscError(keyDenied);
  assert.equal(a.state, 'forbidden-key');
  assert.match(a.detail, /ユーザーとアクセス/);
  assert.match(a.detail, /eas\.json/);

  const noCollection =
    "The resource 'analyticsReportRequests' does not allow 'GET_COLLECTION'. Allowed operations are: CREATE, DELETE, GET_INSTANCE";
  const b = classifyAscError(noCollection);
  assert.equal(b.state, 'error');
  assert.match(b.detail, /\/apps\/\{id\}\/analyticsReportRequests/);

  assert.equal(classifyAscError('その他').state, 'error');
  assert.equal(classifyAscError(undefined).detail, '');
});

/* ---------------- bigquery-probe ---------------- */

test('looksLikePlayTable は Play のエクスポートらしい名前だけ拾う', () => {
  assert.equal(looksLikePlayTable('installs_com_saientecho_app_202609_overview'), true);
  assert.equal(looksLikePlayTable('ratings_country'), true);
  assert.equal(looksLikePlayTable('my_unrelated_table'), false);
  assert.equal(looksLikePlayTable(null), false);
});

test('classify はデータセットとテーブルの有無で 3 通りに分ける', () => {
  assert.equal(classify([]).state, 'no-dataset');
  assert.equal(classify(null).state, 'no-dataset');
  assert.equal(classify([{ id: 'analytics', tables: ['orders'] }]).state, 'no-dataset');

  // 名前は Play っぽいがテーブルが空 = 有効化直後
  const empty = classify([{ id: 'play_export', tables: [] }]);
  assert.equal(empty.state, 'no-dataset');
  assert.match(empty.detail, /空/);

  const on = classify([{ id: 'play_export', tables: ['installs_overview', 'ratings_country'] }]);
  assert.equal(on.state, 'enabled');
  assert.equal(on.matches[0].tableCount, 2);
});

/* ---------------- analytics-report ---------------- */

test('cell は改行とパイプを潰して表を壊さない', () => {
  assert.equal(cell('a\nb'), 'a b');
  assert.equal(cell('a|b'), 'a\\|b');
  assert.equal(cell(null), '-');
  assert.equal(cell('   '), '-');
  assert.equal(cell(0), '0', '0 を - にしない');
});

test('mdTable は行が無ければ null', () => {
  assert.equal(mdTable(['a'], []), null);
  assert.equal(mdTable(['a'], null), null);
  const t = mdTable(['日付', '値'], [['2026-09-10', 1]], ['l', 'r']);
  assert.match(t, /\| 日付 \| 値 \|/);
  assert.match(t, /\| --- \| ---: \|/);
});

test('asPercent は数値だけ % にする', () => {
  assert.equal(asPercent('0.0123'), '1.230%');
  assert.equal(asPercent('-'), '-');
  assert.equal(asPercent(undefined), '-');
});

test('renderSummary は取得できなかった理由を本文に残す', () => {
  const md = renderSummary({
    date: '2026-09-16',
    vitals: {
      package: 'com.example.app',
      freshnessKnown: false,
      start: '2026-09-06',
      end: '2026-09-13',
      days: 7,
      sets: [{ label: 'クラッシュ', ok: false, reason: 'API が未有効です', rows: [] }],
    },
    asc: { state: 'no-request' },
    bigquery: { state: 'forbidden', detail: '権限がありません', matches: [] },
    notes: ['メモ'],
  });
  assert.match(md, /API が未有効です/);
  assert.match(md, /--create-asc-request/);
  assert.match(md, /権限がありません/);
  assert.match(md, /データ鮮度を API から取れなかった/);
  assert.match(md, /メモ/);
  // 空行が 3 連続しない（Markdown が間延びしない）
  assert.equal(/\n{3,}/.test(md), false);
});

test('renderSummary は vitals も asc も無い状態でも落ちない', () => {
  const md = renderSummary({ date: '2026-09-16' });
  assert.match(md, /2026-09-16/);
  assert.match(md, /取得していない/);
});
