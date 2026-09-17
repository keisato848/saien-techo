/**
 * ストア指標の集計まわりの純粋関数。実行: `pnpm test:scripts`（node --test）。
 *
 * 狙いは「壊れた入力で落ちないこと」。この 3 つは外部 API の返り値が入口なので、
 * 列名の改称・空レスポンス・数値でない値が普通に来る。**歯のあるテストにするため、
 * 正常系だけでなく壊れた入力を必ず 1 件ずつ入れてある。**
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
import {
  classifyProductType,
  dateRange,
  getSales,
  parseSalesTsv,
  summarizeSales,
} from './asc-sales.mjs';
import {
  bucketName,
  classifyMissing,
  decodeCsv,
  recentMonths,
  reportUrl,
  summarizeInstalls,
  summarizeStorePerformance,
} from './play-reports.mjs';
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
    // BOM はソースに直接書かず組み立てる（リテラルを埋めると git がバイナリ判定する）
    `${String.fromCharCode(0xfeff)}Date\tSource Type\tCounts\n2026-09-10\t検索\t100\n2026-09-11\t閲覧`,
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

/* ---------------- ソースの衛生 ---------------- */

test('リリース系スクリプトに制御文字を埋めない（git がバイナリ判定するため）', () => {
  // 2026-09-17: 区切り文字として U+0000 を、BOM 判定として U+FEFF を**リテラルで**
  // 書いたせいで git が asc-analytics.mjs をバイナリと判定し、PR #196 の差分が
  // レビューできない状態でマージされた。エスケープや組み立てで書けば済む
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.mjs'));
  assert.ok(files.length >= 5, '走査対象が見つかっている');
  for (const f of files) {
    const buf = fs.readFileSync(path.join(dir, f));
    assert.equal(buf.indexOf(0x00), -1, `${f}: NUL が埋まっている`);
    assert.equal(buf.indexOf(Buffer.from('EFBBBF', 'hex')), -1, `${f}: BOM が埋まっている`);
  }
});

/* ---------------- asc-sales ---------------- */

test('classifyProductType は更新と再ダウンロードを新規に混ぜない', () => {
  assert.equal(classifyProductType('1'), 'download');
  assert.equal(classifyProductType('1F'), 'download');
  assert.equal(classifyProductType('7'), 'update');
  assert.equal(classifyProductType('3'), 'redownload', '実測で出た区分（再ダウンロード）');
  // 知らない識別子を黙って download に倒さない
  assert.equal(classifyProductType('IA1'), 'other');
  assert.equal(classifyProductType(''), 'other');
  assert.equal(classifyProductType(undefined), 'other');
});

test('dateRange は end から遡り、不正な days を 30 に丸める', () => {
  const end = new Date(Date.UTC(2026, 8, 17));
  assert.deepEqual(dateRange(end, 3), ['2026-09-15', '2026-09-16', '2026-09-17']);
  assert.equal(dateRange(end, 0).length, 30);
  assert.equal(dateRange(end, 'abc').length, 30);
  assert.equal(dateRange(new Date('壊れた'), 2).length, 2, '壊れた Date でも落ちない');
});

test('summarizeSales は SKU で絞り、区分ごとに分けて数える', () => {
  // 実際の列名で組む（2026-09-17 のレポートから）
  const row = (sku, type, units, extra = {}) => ({
    SKU: sku,
    'Product Type Identifier': type,
    Units: String(units),
    Device: 'iPhone',
    Version: '1.3.0',
    'Country Code': 'JP',
    ...extra,
  });
  const rows = [
    row('saien-techo', '1', 5),
    row('saien-techo', '7', 4),
    row('saien-techo', '3', 1),
    row('saien-techo', '1', 3, { Device: 'iPad', Version: '1.2.0' }),
    row('daidoko', '1', 99),
  ];
  const s = summarizeSales(rows, { sku: 'saien-techo' });
  assert.equal(s.downloads, 8, '別 SKU を巻き込まない');
  assert.equal(s.updates, 4);
  assert.equal(s.redownloads, 1);
  assert.equal(s.other, 0);
  assert.deepEqual(s.byDevice, [
    ['iPhone', 5],
    ['iPad', 3],
  ]);
  // 端末・版は新規ダウンロードだけを数える（更新を混ぜない）
  assert.equal(
    s.byDevice.reduce((a, [, v]) => a + v, 0),
    s.downloads,
  );
  assert.deepEqual(s.byCountry, [['JP', 13]]);

  // 知らない区分は other に積み、識別子を残す
  const u = summarizeSales([row('x', 'ZZ', 2)], {});
  assert.equal(u.other, 2);
  assert.deepEqual(u.unknownTypes, ['ZZ']);

  // 壊れた入力
  assert.equal(summarizeSales(null).downloads, 0);
  assert.equal(summarizeSales([]).rowCount, 0);
});

test('parseSalesTsv はヘッダだけ・空でも落ちない', () => {
  assert.deepEqual(parseSalesTsv('SKU\tUnits'), []);
  assert.deepEqual(parseSalesTsv(''), []);
  assert.deepEqual(parseSalesTsv(null), []);
  const rows = parseSalesTsv('SKU\tUnits\nsaien-techo\t5');
  assert.deepEqual(rows, [{ SKU: 'saien-techo', Units: '5' }]);
});

test('getSales はベンダー番号が無ければ取得を試みない', async () => {
  const r = await getSales({ vendorNumber: null });
  assert.equal(r.state, 'no-vendor');
  assert.match(r.detail, /支払いと財務レポート/);
});

/* ---------------- play-reports ---------------- */

test('reportUrl は命名規則どおりに組み立て、不正な入力で投げる', () => {
  const u = reportUrl({
    developerId: '4806763604853146902',
    packageName: 'com.saientecho.app',
    group: 'installs',
    month: '202609',
    kind: 'overview',
  });
  assert.equal(
    u,
    'https://storage.cloud.google.com/pubsite_prod_4806763604853146902/stats/installs/installs_com.saientecho.app_202609_overview.csv?authuser=0',
  );
  assert.throws(() => bucketName('abc'), /デベロッパー ID/);
  assert.throws(() => bucketName(''), /デベロッパー ID/);
  assert.throws(
    () =>
      reportUrl({
        developerId: '1234567',
        packageName: 'x',
        group: 'installs',
        month: '2026-09',
        kind: 'overview',
      }),
    /YYYYMM/,
  );
});

test('decodeCsv は UTF-16LE を読む（UTF-8 として読むと全部化ける）', () => {
  const text = 'Date,Package name\n2026-09-01,com.example\n';
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(decodeCsv(utf16), text);
  // BOM 無しの UTF-8 もそのまま読める
  assert.equal(decodeCsv(Buffer.from(text, 'utf8')), text);
  assert.equal(decodeCsv(null), '');
});

test('summarizeInstalls は断面の列を合計しない', () => {
  // 実データの形（2026-09 の overview）。稼働台数 1 が 6 日続く
  const rows = [
    {
      Date: '2026-09-01',
      'Install events': '0',
      'Uninstall events': '1',
      'Active Device Installs': '0',
      'Total User Installs': '0',
    },
    {
      Date: '2026-09-04',
      'Install events': '1',
      'Uninstall events': '0',
      'Active Device Installs': '1',
      'Total User Installs': '0',
    },
    {
      Date: '2026-09-08',
      'Install events': '0',
      'Uninstall events': '0',
      'Active Device Installs': '1',
      'Total User Installs': '0',
    },
  ];
  const s = summarizeInstalls(rows);
  assert.equal(s.totals['Install events'], 1, '事象は合計する');
  assert.equal(s.totals['Uninstall events'], 1);
  assert.equal(s.latest['Active Device Installs'], 1, '断面は最終日の値（合計の 2 ではない）');
  assert.equal(s.lastDate, '2026-09-08');
  // 断面の列が totals に混ざっていないこと
  assert.equal('Active Device Installs' in s.totals, false);
  assert.deepEqual(summarizeInstalls([]).totals, {});
  assert.deepEqual(summarizeInstalls(null).latest, {});
});

test('summarizeStorePerformance は転換率を行平均せず合計から出す', () => {
  const rows = [
    {
      Date: '1',
      'Traffic source': 'Other',
      'Store listing visitors': '1',
      'Store listing acquisitions': '0',
      'Store listing conversion rate': '0.0',
    },
    {
      Date: '2',
      'Traffic source': 'Other',
      'Store listing visitors': '1',
      'Store listing acquisitions': '1',
      'Store listing conversion rate': '1.0',
    },
  ];
  const s = summarizeStorePerformance(rows);
  assert.equal(s.visitors, 2);
  assert.equal(s.acquisitions, 1);
  assert.equal(s.conversion, 0.5, '行ごとの 0.0 と 1.0 を平均した 0.5 ではなく、1/2 として 0.5');
  assert.deepEqual(s.byGroup, [{ name: 'Other', visitors: 2, acquisitions: 1 }]);
  // 訪問者ゼロで割らない
  const z = summarizeStorePerformance([
    { 'Store listing visitors': '0', 'Store listing acquisitions': '0', 'Traffic source': 'x' },
  ]);
  assert.equal(z.conversion, null);
  assert.equal(summarizeStorePerformance([]).visitors, 0);
});

test('classifyMissing は「未生成」と「ログイン切れ」を言い分ける', () => {
  const a = classifyMissing({
    month: '202608',
    failedKinds: ['installs/overview'],
    okKindsSameMonth: ['store_performance/traffic_source'],
  });
  assert.match(a, /生成されていない/);
  // 他の月が取れているならセッションは生きている（公開前の月をセッション切れと言わない）
  const b = classifyMissing({
    month: '202607',
    failedKinds: ['installs/overview'],
    okKindsSameMonth: [],
    anySuccessInRun: true,
  });
  assert.match(b, /まだ公開していない/);
  assert.equal(/セッション/.test(b), false);
  const c = classifyMissing({
    month: '202608',
    failedKinds: ['installs/overview'],
    okKindsSameMonth: [],
    anySuccessInRun: false,
  });
  assert.match(c, /セッションが切れている/);
});

test('recentMonths は古い順で n か月を返す', () => {
  assert.deepEqual(recentMonths(3, new Date(Date.UTC(2026, 8, 17))), [
    '202607',
    '202608',
    '202609',
  ]);
  assert.deepEqual(
    recentMonths(2, new Date(Date.UTC(2026, 0, 5))),
    ['202512', '202601'],
    '年をまたぐ',
  );
  assert.equal(recentMonths('abc', new Date(Date.UTC(2026, 8, 17))).length, 3);
});
