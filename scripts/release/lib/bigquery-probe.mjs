/**
 * Play Console の「統計情報の BigQuery エクスポート」が有効かを、
 * **ブラウザを開かずに** REST API だけで判定する。
 *
 * なぜ要るか: Play Developer Reporting API は Vitals しか返さないので、
 * リーチ・獲得・検索キーワードは BigQuery エクスポート経由しか道が無い
 * （play-vitals.mjs の冒頭を参照）。だが「エクスポートが有効かどうか」自体が
 * Play Console の画面にしか書いていない。ここでは結果側（BigQuery に
 * データセットとテーブルが在るか）から逆に判定する。
 *
 * 判定は 4 通り。**どれも例外にせず state で返す**（未設定は障害ではない）:
 *   enabled    … それらしいデータセットとテーブルが在る
 *   no-dataset … BigQuery は読めるが、Play のエクスポート先が見つからない
 *   forbidden  … API 未有効か、サービスアカウントに BigQuery の権限が無い
 *   error      … それ以外（ネットワーク等）
 *
 * このモジュールは読み取り専用。データセットもテーブルも作らない。
 */
const BQ_BASE = 'https://bigquery.googleapis.com/bigquery/v2';

export const BIGQUERY_SCOPE = 'https://www.googleapis.com/auth/bigquery.readonly';

/**
 * Play のエクスポートが作るテーブル名の手がかり。
 * Play Console は `installs_*` / `crashes_*` / `ratings_*` / `stats_*` といった
 * 接頭辞でテーブルを作る。名前は変わりうるので、部分一致で緩く見る。
 */
const TABLE_HINTS = [
  'install',
  'acquisition',
  'retained',
  'rating',
  'review',
  'crash',
  'store_performance',
  'stats',
];

/* ------------------------------------------------------------------ *
 * 純粋関数（テスト対象）
 * ------------------------------------------------------------------ */

/** データセット名が Play のエクスポート先らしいか */
export function looksLikePlayDataset(datasetId) {
  return /play|android|gplay/i.test(String(datasetId ?? ''));
}

/** テーブル名が Play のエクスポートらしいか */
export function looksLikePlayTable(tableId) {
  const id = String(tableId ?? '').toLowerCase();
  return TABLE_HINTS.some((h) => id.includes(h));
}

/**
 * データセットとテーブルの一覧から判定する。ネットワークに触らない部分。
 * `datasets` は [{ id, tables: [id, ...] }] の形。
 */
export function classify(datasets) {
  const list = Array.isArray(datasets) ? datasets : [];
  if (list.length === 0)
    return {
      state: 'no-dataset',
      detail: 'BigQuery にデータセットが 1 つもありません',
      matches: [],
    };

  const matches = [];
  for (const ds of list) {
    const tables = (ds?.tables ?? []).filter(looksLikePlayTable);
    if (tables.length > 0 || looksLikePlayDataset(ds?.id)) {
      matches.push({ dataset: ds?.id, tables: tables.slice(0, 10), tableCount: tables.length });
    }
  }
  if (matches.length === 0)
    return {
      state: 'no-dataset',
      detail: `データセットは ${list.length} 件ありますが、Play のエクスポートらしいものはありません`,
      matches: [],
    };
  const withTables = matches.filter((m) => m.tableCount > 0);
  if (withTables.length === 0)
    return {
      state: 'no-dataset',
      detail:
        'それらしいデータセットはありますが、エクスポートのテーブルが空です（有効化直後の可能性）',
      matches,
    };
  return {
    state: 'enabled',
    detail: 'エクスポート先のテーブルが見つかりました',
    matches: withTables,
  };
}

/* ------------------------------------------------------------------ *
 * ネットワーク
 * ------------------------------------------------------------------ */

async function bq(path, token) {
  const res = await fetch(`${BQ_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * 判定の入口。projectId は既定でサービスアカウントの project_id
 * （呼び側が serviceAccountProjectId() を渡す）。
 */
export async function probeBigQueryExport({ projectId, token }) {
  if (!projectId) return { state: 'error', detail: 'projectId が渡されていません', matches: [] };
  try {
    const ds = await bq(
      `/projects/${encodeURIComponent(projectId)}/datasets?maxResults=200`,
      token,
    );
    if (ds.status === 403 || ds.status === 401) {
      return {
        state: 'forbidden',
        detail:
          'BigQuery を読めません。GCP で BigQuery API を有効化し、このサービスアカウントに「BigQuery データ閲覧者」と「BigQuery ジョブユーザー」を付けてください',
        matches: [],
      };
    }
    if (!ds.ok) {
      return {
        state: 'error',
        detail: `データセット一覧の取得に失敗（HTTP ${ds.status}）: ${String(ds.body?.error?.message ?? '').slice(0, 160)}`,
        matches: [],
      };
    }
    const datasets = [];
    for (const d of ds.body.datasets ?? []) {
      const id = d?.datasetReference?.datasetId;
      if (!id) continue;
      const t = await bq(
        `/projects/${encodeURIComponent(projectId)}/datasets/${encodeURIComponent(id)}/tables?maxResults=200`,
        token,
      );
      const tables = t.ok
        ? (t.body.tables ?? []).map((x) => x?.tableReference?.tableId).filter(Boolean)
        : [];
      datasets.push({ id, tables });
    }
    return { ...classify(datasets), projectId, datasetCount: datasets.length };
  } catch (e) {
    return { state: 'error', detail: String(e?.message ?? e).slice(0, 200), matches: [] };
  }
}
