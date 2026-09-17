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

/** B' 群（BigQuery エクスポート）の節 */
export function renderBigQuery(bq) {
  const out = ['## 3. Play のリーチ・獲得（BigQuery エクスポート）', ''];
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
export function renderSummary({ date, vitals, asc, bigquery, notes = [] }) {
  const lines = [
    `# 流入とVitalsの数字 — ${cell(date)} 取得`,
    '',
    '`node scripts/release/store-analytics.mjs` が自動生成した。手で編集すると次回の実行で消える。',
    '',
    '取得元は API のみ（ブラウザのスクショは使っていない）。取れなかった項目は理由を残してある。',
    '',
    ...renderVitals(vitals),
    ...renderAsc(asc),
    ...renderBigQuery(bigquery),
    '## 4. 取得していないもの',
    '',
    '- **Apple Ads Basic のキャンペーン別内訳** — Basic プランでは App Store Connect の画面でも内訳が出ず、API でも取れない。Advanced へ切り替えない限り自動化しても得るものが無い',
    '- **Play のインストール数・全ユーザー数** — Developer Reporting API の対象外。上の BigQuery エクスポートが唯一の道',
    '',
  ];
  if (notes.length > 0) {
    lines.push('## 5. 実行時のメモ', '');
    for (const n of notes) lines.push(`- ${cell(n)}`);
    lines.push('');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n')}\n`;
}
