/**
 * 取得した数字を Markdown 1 枚へ整形する。**純粋関数だけ**（ネットワークにもファイルにも触らない）。
 * だいどこの `analytics/2026-09-10/summary.md` を手で書いていた形に揃えてある。
 *
 * 方針: **取れなかったものを黙って落とさない。** 取れない理由を同じ表に残す。
 * 空欄と「API 未有効」は別物で、後者は行動が要る。
 */

/** セルの中で表が壊れないようにする。改行とパイプだけ潰す */
export function cell(v) {
  if (v === null || v === undefined) return '-';
  const s = String(v).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  return s.length === 0 ? '-' : s;
}

/**
 * Markdown の表を作る。`align` は 'l' | 'r' の配列（既定は全部左）。
 * 行が 0 件なら null を返す（呼び側が「該当なし」を書く）。
 */
export function mdTable(headers, rows, align = []) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sep = headers.map((_, i) => (align[i] === 'r' ? ' ---: ' : ' --- '));
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `|${sep.join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n');
}

/** 比率のメトリクスを % 表記へ。数値でなければそのまま返す */
export function asPercent(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return cell(v);
  return `${(n * 100).toFixed(3)}%`;
}

/** A 群（Play Vitals）の節 */
export function renderVitals(vitals) {
  if (!vitals)
    return ['## 1. Android Vitals（Play Developer Reporting API）', '', '取得していない。', ''];
  const out = ['## 1. Android Vitals（Play Developer Reporting API）', ''];
  out.push(
    `対象: \`${cell(vitals.package)}\` / 期間: ${cell(vitals.start)} 〜 ${cell(vitals.end)}（${cell(vitals.days)} 日）`,
  );
  if (!vitals.freshnessKnown)
    out.push(
      '',
      '> データ鮮度を API から取れなかったので、実行日の 3 日前を期間の終わりに置いている。',
    );
  out.push('');

  for (const set of vitals.sets ?? []) {
    out.push(`### ${cell(set.label)}`, '');
    if (!set.ok) {
      out.push(`取得できなかった: ${cell(set.reason)}`, '');
      continue;
    }
    if ((set.rows ?? []).length === 0) {
      out.push('期間中に報告なし。', '');
      continue;
    }
    const rateKey = (set.metrics ?? []).find((m) => m !== 'distinctUsers') ?? 'rate';
    // ディメンション（startType 等）を持つセットだけ「区分」列を足す
    const hasDimension = set.rows.some((r) => r.dimension !== undefined);
    const headers = hasDimension
      ? ['日付', '区分', rateKey, 'distinctUsers']
      : ['日付', rateKey, 'distinctUsers'];
    const align = hasDimension ? ['l', 'l', 'r', 'r'] : ['l', 'r', 'r'];
    const table = mdTable(
      headers,
      set.rows.map((r) =>
        hasDimension
          ? [r.date, r.dimension ?? '-', asPercent(r[rateKey]), r.distinctUsers ?? '-']
          : [r.date, asPercent(r[rateKey]), r.distinctUsers ?? '-'],
      ),
      align,
    );
    out.push(table ?? '該当なし。', '');
  }
  return out;
}

/** B 群（ASC Analytics）の節 */
export function renderAsc(asc) {
  const out = ['## 2. App Store の流入（App Store Connect Analytics Reports API）', ''];
  if (!asc) {
    out.push('取得していない。', '');
    return out;
  }
  if (asc.state === 'no-request') {
    out.push(
      'レポート要求がまだ無い。**このスクリプトは既定では作らない**（App Store Connect への書き込みになるため）。',
      '',
      '作るなら `node scripts/release/store-analytics.mjs --create-asc-request`。作成から 24〜48 時間はデータが出ない。',
      '',
    );
    return out;
  }
  if (!Array.isArray(asc.reports)) {
    out.push(`取得できなかった（${cell(asc.state)}）: ${cell(asc.detail)}`, '');
    return out;
  }
  if (asc.detail) out.push(cell(asc.detail), '');

  // 欲しい数字は 1 つのレポートに揃っていないので、レポートごとに節を作る
  for (const rep of asc.reports) {
    out.push(`### ${cell(rep.label)}`, '');
    if (rep.state !== 'ok') {
      out.push(
        `取得できなかった（${cell(rep.state)}）: ${cell(rep.detail)}`,
        ...(rep.reportName ? ['', `対象レポート: ${cell(rep.reportName)}`] : []),
        '',
      );
      continue;
    }
    out.push(
      `レポート: ${cell(rep.reportName)} / 粒度: ${cell(rep.granularity)} / 処理日: ${cell(rep.processingDate)} / 行数: ${cell(rep.rowCount)}`,
      '',
    );
    const s = rep.summary;
    if (!s?.ok) {
      out.push(
        `ソースタイプ別に畳めなかった: ${cell(s?.reason)}`,
        '',
        `実際の列: ${(s?.header ?? []).map((h) => `\`${h}\``).join(', ') || '（不明）'}`,
        '',
        '> 列名が変わった可能性がある。`summarizeBySource` の候補名を足すこと。',
        '',
      );
      continue;
    }
    const table = mdTable(
      ['ソースタイプ', '種別', '件数'],
      s.rows.map((r) => [r.source, r.kind, r.value.toLocaleString('ja-JP')]),
      ['l', 'l', 'r'],
    );
    out.push(table ?? '該当なし。', '');
  }
  return out;
}

/** 売上とトレンド（何人が入れたか）の節 */
export function renderSales(sales) {
  const out = ['## 3. App Store のダウンロード数（売上とトレンド API・同期）', ''];
  if (!sales) {
    out.push('取得していない。', '');
    return out;
  }
  if (sales.state !== 'ok') {
    out.push(`取得できなかった（${cell(sales.state)}）: ${cell(sales.detail)}`, '');
    return out;
  }
  const s = sales.summary;
  out.push(
    `期間: ${cell(sales.from)} 〜 ${cell(sales.to)}（要求 ${cell(sales.days)} 日 / 実際に見た ${cell(sales.countedDays ?? sales.days)} 日 / 売上なし ${cell(sales.emptyDays)} 日 / 未生成 ${cell(sales.pendingDays ?? 0)} 日）`,
    '',
  );
  const main = mdTable(
    ['区分', '件数'],
    [
      ['新規ダウンロード', s.downloads],
      ['アップデート', s.updates],
      ['再ダウンロード', s.redownloads],
      ...(s.other > 0 ? [[`区分不明（${s.unknownTypes.join(', ')}）`, s.other]] : []),
    ],
    ['l', 'r'],
  );
  out.push(main ?? '該当なし。', '');
  out.push('> **区分を足し合わせない。** アップデートと再ダウンロードは新規の利用者ではない。', '');

  for (const [title, pairs] of [
    ['端末別（新規ダウンロード）', s.byDevice],
    ['入れた版（新規ダウンロード）', s.byVersion],
    ['国別（全区分）', s.byCountry],
  ]) {
    const t = mdTable(
      [title.split('（')[0], '件数'],
      pairs.map(([k, v]) => [k, v]),
      ['l', 'r'],
    );
    if (t) out.push(`### ${title}`, '', t, '');
  }

  if ((sales.failed ?? []).length > 0) {
    out.push('### 取得に失敗した日', '');
    for (const f of sales.failed.slice(0, 10)) out.push(`- ${cell(f)}`);
    out.push('');
  }
  return out;
}

/** Play の掲載ページとインストール（Console の月次レポート） */
export function renderPlayReports(play) {
  const out = ['## 4. Play の掲載ページとインストール（Console の月次レポート）', ''];
  if (!play) {
    out.push('取得していない（`node scripts/release/fetch-play-reports.mjs` で落とす）。', '');
    return out;
  }
  if (play.state !== 'ok') {
    out.push(`取得できなかった（${cell(play.state)}）: ${cell(play.detail)}`, '');
    return out;
  }

  const perf = mdTable(
    ['月', '掲載ページ訪問者', '獲得', '転換率'],
    (play.performance ?? []).map((p) => [
      p.month,
      p.visitors,
      p.acquisitions,
      p.conversion === null ? '-' : `${(p.conversion * 100).toFixed(1)}%`,
    ]),
    ['l', 'r', 'r', 'r'],
  );
  out.push('### 掲載ページの成績', '', perf ?? '該当なし。', '');

  const sources = [];
  for (const p of play.performance ?? [])
    for (const g of p.byGroup ?? []) sources.push([p.month, g.name, g.visitors, g.acquisitions]);
  const src = mdTable(['月', '流入元', '訪問者', '獲得'], sources, ['l', 'l', 'r', 'r']);
  if (src) out.push('### 流入元別', '', src, '');

  for (const i of play.installs ?? []) {
    out.push(`### インストール ${cell(i.month)}（〜${cell(i.lastDate)}）`, '');
    const t = mdTable(
      ['項目', '値'],
      [
        ...Object.entries(i.totals ?? {}).map(([k, v]) => [`${k}（期間合計）`, v]),
        ...Object.entries(i.latest ?? {}).map(([k, v]) => [`${k}（最終日の断面）`, v]),
      ],
      ['l', 'r'],
    );
    out.push(t ?? '該当なし。', '');
  }
  out.push(
    '> **断面の列を足さない。** 稼働台数や累計インストールは日ごとの状態なので、期間合計に意味はない。',
    '',
  );
  return out;
}

/** B' 群（BigQuery エクスポート）の節 */
export function renderBigQuery(bq) {
  const out = ['## 5. Play のリーチ・獲得（BigQuery エクスポート・参考）', ''];
  if (!bq) {
    out.push('判定していない（`--check-bigquery` で判定する）。', '');
    return out;
  }
  const label =
    {
      enabled: '**有効**',
      'no-dataset': '**無効か、エクスポート先がこのプロジェクトにない**',
      forbidden: '**判定不可（権限不足）**',
      error: '**判定不可（エラー）**',
    }[bq.state] ?? cell(bq.state);

  out.push(`判定: ${label}`, '', cell(bq.detail), '');
  if (bq.projectId)
    out.push(
      `探索したプロジェクト: \`${cell(bq.projectId)}\`（データセット ${cell(bq.datasetCount)} 件）`,
      '',
    );
  const table = mdTable(
    ['データセット', 'それらしいテーブル数', '例'],
    (bq.matches ?? []).map((m) => [
      m.dataset,
      m.tableCount,
      (m.tables ?? []).slice(0, 3).join(', '),
    ]),
    ['l', 'r', 'l'],
  );
  if (table) out.push(table, '');
  if (bq.state === 'no-dataset')
    out.push(
      '> 有効化は Play Console の「ダウンロードとエクスポート」から行う。ブラウザ操作なのでこのスクリプトでは代行しない。',
      '',
    );
  return out;
}

/** 全体。戻り値は Markdown 文字列 */
export function renderSummary({ date, vitals, asc, sales, play, bigquery, notes = [] }) {
  const lines = [
    `# 流入とVitalsの数字 — ${cell(date)} 取得`,
    '',
    '`node scripts/release/store-analytics.mjs` が自動生成した。手で編集すると次回の実行で消える。',
    '',
    '取得元は API と、Play Console にログイン済みのブラウザで落とした CSV。画面のスクショは使っていない。取れなかった項目は理由を残してある。',
    '',
    ...renderVitals(vitals),
    ...renderAsc(asc),
    ...renderSales(sales),
    ...renderPlayReports(play),
    ...renderBigQuery(bigquery),
    '## 6. 取得していないもの',
    '',
    '- **Apple Ads Basic のキャンペーン別内訳** — Basic プランでは App Store Connect の画面でも内訳が出ず、API でも取れない。Advanced へ切り替えない限り自動化しても得るものが無い',
    '- **Play の検索キーワード別の流入** — Console の月次レポートにも無い。BigQuery エクスポートが要る',
    '',
  ];
  if (notes.length > 0) {
    lines.push('## 7. 実行時のメモ', '');
    for (const n of notes) lines.push(`- ${cell(n)}`);
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
