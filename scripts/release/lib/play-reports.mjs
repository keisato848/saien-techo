/**
 * Play Console の月次レポート（Cloud Storage 上の CSV）。
 *
 * **BigQuery も、サービスアカウントへの権限追加も要らない。**
 * Play Console にログイン済みのブラウザ文脈があれば、`storage.cloud.google.com` の
 * 直リンクからそのまま落とせる（2026-09-17 に実測）。取得側は fetch-play-reports.mjs。
 *
 * 前提の落とし穴:
 *   - **CSV は UTF-16LE**。UTF-8 として読むと全部化ける
 *   - **URL は命名規則で組み立てられる。** 画面を操作して展開する必要はない
 *   - **無い月は 403 が返る**（404 ではない）。権限エラーと区別が付かないので、
 *     「同じ月の別レポートが取れるか」で切り分ける
 *   - **合計してはいけない列がある。** 稼働台数や累計インストールは日ごとの断面なので、
 *     足すと無意味な数字になる（下の SNAPSHOT_COLUMNS）
 */

/** サービスアカウントではなくブラウザのセッションで読む先 */
export const STORAGE_BASE = 'https://storage.cloud.google.com';

/** デベロッパー ID からバケット名を作る */
export function bucketName(developerId) {
  const id = String(developerId ?? '').trim();
  if (!/^\d{5,}$/.test(id)) throw new Error(`デベロッパー ID が不正です: ${id || '(空)'}`);
  return `pubsite_prod_${id}`;
}

/**
 * レポートの CSV URL を組み立てる。
 * group は 'installs' か 'store_performance'、month は 'YYYYMM'。
 */
export function reportUrl({ developerId, packageName, group, month, kind }) {
  if (!/^\d{6}$/.test(String(month ?? ''))) throw new Error(`month は YYYYMM 形式です: ${month}`);
  if (!packageName) throw new Error('packageName が要ります');
  const bucket = bucketName(developerId);
  return `${STORAGE_BASE}/${bucket}/stats/${group}/${group}_${packageName}_${month}_${kind}.csv?authuser=0`;
}

/** 取りに行くレポートの組み合わせ。実測で存在を確認したものだけ */
export const REPORTS = [
  { group: 'installs', kind: 'overview', label: 'インストール（全体）' },
  { group: 'installs', kind: 'country', label: 'インストール（国別）' },
  { group: 'store_performance', kind: 'traffic_source', label: '流入元別' },
  { group: 'store_performance', kind: 'country', label: '掲載ページ（国別）' },
];

/** 直近 n か月の 'YYYYMM' を古い順で返す */
export function recentMonths(n = 3, now = new Date()) {
  const count = Number.isFinite(Number(n)) && Number(n) >= 1 ? Math.floor(Number(n)) : 3;
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/** UTF-16LE / UTF-16BE / UTF-8 を見分けて文字列にする */
export function decodeCsv(buf) {
  if (!buf || buf.length < 2) return '';
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString('utf16le');
  if (b[0] === 0xfe && b[1] === 0xff) return b.subarray(2).swap16().toString('utf16le');
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return b.subarray(3).toString('utf8');
  return b.toString('utf8');
}

/** ごく単純な CSV。Play のレポートは引用符もカンマ入りの値も使わない */
export function parseCsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

/**
 * **日ごとの断面であって、足してはいけない列。**
 * 「稼働台数 1 が 6 日分あるから 6 台」は誤り。最終日の値を見る。
 */
export const SNAPSHOT_COLUMNS = ['Total User Installs', 'Active Device Installs'];

/** 事象の件数なので足してよい列 */
export const EVENT_COLUMNS = [
  'Daily Device Installs',
  'Daily Device Uninstalls',
  'Daily Device Upgrades',
  'Daily User Installs',
  'Daily User Uninstalls',
  'Install events',
  'Update events',
  'Uninstall events',
];

const num = (v) => {
  const n = Number(String(v ?? '').replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

/**
 * インストール系レポートを畳む。
 * 事象の列は合計、断面の列は**最終日の値**を返す。
 */
export function summarizeInstalls(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return { rowCount: 0, totals: {}, latest: {}, lastDate: null };
  const header = Object.keys(list[0]);
  const totals = {};
  for (const c of EVENT_COLUMNS) {
    if (header.includes(c)) totals[c] = list.reduce((a, r) => a + num(r[c]), 0);
  }
  const sorted = [...list].sort((a, b) => String(a.Date).localeCompare(String(b.Date)));
  const last = sorted[sorted.length - 1];
  const latest = {};
  for (const c of SNAPSHOT_COLUMNS) if (header.includes(c)) latest[c] = num(last[c]);
  return { rowCount: list.length, totals, latest, lastDate: last?.Date ?? null };
}

/**
 * 掲載ページの成績を畳む。訪問者と獲得は事象なので合計してよい。
 * 転換率は行ごとの値を平均しない（母数が違う）— 合計から計算し直す。
 */
export function summarizeStorePerformance(rows, { groupBy = 'Traffic source' } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0)
    return { rowCount: 0, visitors: 0, acquisitions: 0, conversion: null, byGroup: [] };
  const header = Object.keys(list[0]);
  const vCol = header.find((h) => /visitors/i.test(h));
  const aCol = header.find((h) => /acquisitions/i.test(h));
  if (!vCol || !aCol)
    return {
      rowCount: list.length,
      visitors: 0,
      acquisitions: 0,
      conversion: null,
      byGroup: [],
      header,
    };

  const key = header.includes(groupBy) ? groupBy : null;
  const groups = new Map();
  let visitors = 0;
  let acquisitions = 0;
  for (const r of list) {
    const v = num(r[vCol]);
    const a = num(r[aCol]);
    visitors += v;
    acquisitions += a;
    if (!key) continue;
    const g = r[key] || '（不明）';
    const cur = groups.get(g) ?? { visitors: 0, acquisitions: 0 };
    cur.visitors += v;
    cur.acquisitions += a;
    groups.set(g, cur);
  }
  return {
    rowCount: list.length,
    visitors,
    acquisitions,
    // **行ごとの転換率を平均しない。** 合計から出す
    conversion: visitors > 0 ? acquisitions / visitors : null,
    byGroup: [...groups.entries()]
      .map(([name, x]) => ({ name, ...x }))
      .sort((a, b) => b.visitors - a.visitors),
  };
}

/**
 * 403 の意味を切り分ける。
 * **同じ月の別レポートが取れていれば「その月のそのレポートが無い」**、
 * 1 つも取れていなければログイン切れか権限の問題。
 */
export function classifyMissing({ month, failedKinds, okKindsSameMonth, anySuccessInRun }) {
  if ((okKindsSameMonth ?? []).length > 0)
    return `${month}: ${failedKinds.join(', ')} は生成されていない（同月の他レポートは取得できた）`;
  if (anySuccessInRun)
    // **他の月が取れているならセッションは生きている。** 公開前の月はこちらに来る
    return `${month}: レポートが 1 件も無い（その月はまだ公開していないか、集計対象外）`;
  return `${month}: 1 件も取得できない。Play Console のセッションが切れている可能性がある（--login で開き直す）`;
}

/**
 * 保存済みの CSV を読んでまとめる。**ネットワークには触らない**（fetch-play-reports.mjs が先に落とす）。
 * ディレクトリが無い・空なら state を返して静かに終わる。
 */
export function readSavedReports({ dir, packageName, fs, path }) {
  if (!fs.existsSync(dir))
    return {
      state: 'no-data',
      detail: `${dir} がありません。先に node scripts/release/fetch-play-reports.mjs を実行してください`,
    };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && f.includes(packageName));
  if (files.length === 0)
    return { state: 'no-data', detail: `${dir} に ${packageName} の CSV がありません` };

  const installs = [];
  const perf = [];
  for (const f of files) {
    const rows = parseCsv(decodeCsv(fs.readFileSync(path.join(dir, f))));
    const m = /_(\d{6})_([a-z_]+)\.csv$/.exec(f);
    const month = m?.[1] ?? '不明';
    const kind = m?.[2] ?? '不明';
    if (f.startsWith('installs_') && kind === 'overview') installs.push({ month, rows });
    if (f.startsWith('store_performance_') && kind === 'traffic_source') perf.push({ month, rows });
  }
  return {
    state: 'ok',
    files: files.length,
    installs: installs
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((x) => ({ month: x.month, ...summarizeInstalls(x.rows) })),
    performance: perf
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((x) => ({ month: x.month, ...summarizeStorePerformance(x.rows) })),
  };
}
