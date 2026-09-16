/**
 * Play Developer Reporting API（v1beta1）の薄いクライアント。
 * store-status.mjs と store-analytics.mjs で共有する。
 *
 * **この API で取れるのは Android Vitals（クラッシュ・ANR・電池・描画）だけ。**
 * インストール数・全ユーザー数・検索キーワードは返らない。それらは Play Console の
 * UI か、Play Console で有効化する BigQuery エクスポート経由でしか取れない
 * （bigquery-probe.mjs を参照）。
 *
 * 落とし穴が 2 つあり、どちらも実測で踏んでいる:
 *   1. `endTime` が「データ鮮度」を超えると 400 INVALID_ARGUMENT で落ちる。鮮度は
 *      2〜3 日遅れるので、必ず metricSet の freshnessInfo を読んでから期間を決める
 *   2. 同じサービスアカウントでも GCP 側で API を有効化していないと 403。これは
 *      設定漏れであってバグではないので、例外にせず案内文を返して続行する
 */
const REPORTING_BASE = 'https://playdeveloperreporting.googleapis.com/v1beta1';

export const VITALS_SCOPE = 'https://www.googleapis.com/auth/playdeveloperreporting';

/**
 * 取得するメトリクスセット。値は **2026-09-16 に API へ問い合わせて確定した**もので、
 * 憶測ではない（不正なメトリクス名を投げると、API が正しい組み合わせを 400 の本文で返す）。
 *
 * 注意点が 3 つある:
 *   - `stuckBackgroundWakelockRateMetricSet` のメトリクス名は `stuckBgWakelockRate`。
 *     セット名から素直に綴ると 400 になる
 *   - `slowStartRateMetricSet` は **`startType` ディメンションが必須**。省くと 400
 *   - `slowRenderingRateMetricSet` は **ゲーム専用**（403「only accessible to games」）。
 *     さいえん手帳では取れないので既定に入れない。GAMES_ONLY_METRIC_SETS に退避してある
 *
 * セット単位で失敗を閉じ込め、他のセットの取得は続ける（queryMetricSet の ok を見る）。
 */
export const METRIC_SETS = [
  { id: 'crashRateMetricSet', label: 'クラッシュ', metrics: ['crashRate', 'distinctUsers'] },
  { id: 'anrRateMetricSet', label: 'ANR（応答なし）', metrics: ['anrRate', 'distinctUsers'] },
  {
    id: 'slowStartRateMetricSet',
    label: '起動が遅い',
    metrics: ['slowStartRate', 'distinctUsers'],
    dimensions: ['startType'],
  },
  {
    id: 'excessiveWakeupRateMetricSet',
    label: '過剰なウェイクアップ',
    metrics: ['excessiveWakeupRate', 'distinctUsers'],
  },
  {
    id: 'stuckBackgroundWakelockRateMetricSet',
    label: 'バックグラウンドのウェイクロック滞留',
    metrics: ['stuckBgWakelockRate', 'distinctUsers'],
  },
];

/** ゲームにしか開かれていないセット。非ゲームで投げると 403 になるので既定から外してある */
export const GAMES_ONLY_METRIC_SETS = [
  {
    id: 'slowRenderingRateMetricSet',
    label: '描画が遅い（ゲーム専用）',
    metrics: ['slowRenderingRate', 'distinctUsers'],
  },
];

/* ------------------------------------------------------------------ *
 * 純粋関数（テスト対象）。ネットワークに触らない
 * ------------------------------------------------------------------ */

/** Date → API が要求する { year, month, day }（UTC） */
export function ymd(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime()))
    throw new TypeError('ymd: Date が要ります');
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** { year, month, day } → 'YYYY-MM-DD'。欠けていれば '-' */
export function ymdToIso(v) {
  if (!v || typeof v !== 'object') return '-';
  const { year, month, day } = v;
  if (!year || !month || !day) return '-';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * freshnessInfo から DAILY の最新日を取り出す。
 * 取れなければ null（呼び側が「3 日前」へフォールバックする）。
 */
export function dailyFreshness(metricSetBody) {
  const list = metricSetBody?.freshnessInfo?.freshnesses;
  if (!Array.isArray(list)) return null;
  const daily = list.find((f) => f?.aggregationPeriod === 'DAILY')?.latestEndTime;
  if (!daily?.year || !daily?.month || !daily?.day) return null;
  return new Date(Date.UTC(daily.year, daily.month - 1, daily.day));
}

/**
 * 集計期間を決める。end は鮮度日（無ければ now の 3 日前）、start は end の days 日前。
 * **days が 1 未満・非数なら 7 に丸める**（CLI の --days に何が来ても 400 を出さない）。
 */
export function resolveRange(freshnessEnd, days, now = new Date()) {
  const n = Number(days);
  const span = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
  const end =
    freshnessEnd instanceof Date && !Number.isNaN(freshnessEnd.getTime())
      ? freshnessEnd
      : new Date(now.getTime() - 3 * 86400_000);
  return { start: new Date(end.getTime() - span * 86400_000), end, days: span };
}

/**
 * 1 行を { date, 区分, <metric>: value } へ畳む。
 * decimalValue.value / value のどちらで来ても拾い、無ければ '-'。
 * ディメンション（startType 等）は valueLabel を優先して 1 つの文字列にまとめる。
 */
export function foldRow(row) {
  const out = { date: ymdToIso(row?.startTime) };
  const dims = [];
  for (const d of row?.dimensions ?? []) {
    if (!d?.dimension) continue;
    dims.push(String(d.valueLabel ?? d.stringValue ?? d.int64Value ?? '-'));
  }
  if (dims.length > 0) out.dimension = dims.join(' / ');
  for (const m of row?.metrics ?? []) {
    if (!m?.metric) continue;
    out[m.metric] = m.decimalValue?.value ?? m.value ?? '-';
  }
  return out;
}

/** 403 の本文から GCP プロジェクト番号を拾う。無ければ null */
export function projectFromForbidden(message) {
  const m = /project (\d+)/.exec(String(message ?? ''));
  return m ? m[1] : null;
}

/**
 * 403 が「API 未有効」なのかを本文で見分ける。
 *
 * **全部の 403 を「未有効」と決めつけてはいけない。** 実測（2026-09-16）では
 * `slowRenderingRateMetricSet` が「only accessible to games」で 403 を返し、
 * 同じトークンで crashRateMetricSet は成功していた。未有効と書くと、直さなくてよい
 * 設定を直しに行かせることになる。
 */
export function isApiDisabled(message) {
  return /SERVICE_DISABLED|has not been used in project|is disabled/i.test(String(message ?? ''));
}

/** 403 のときに出す説明。未有効のときだけ有効化 URL を添える */
export function forbiddenReason(message) {
  const text = String(message ?? '').slice(0, 300);
  if (!isApiDisabled(text)) return `403（権限または対象外）: ${text || '理由の記載なし'}`;
  const project = projectFromForbidden(text);
  const url = project
    ? `https://console.developers.google.com/apis/api/playdeveloperreporting.googleapis.com/overview?project=${project}`
    : 'https://console.developers.google.com/apis/library/playdeveloperreporting.googleapis.com';
  return `Play Developer Reporting API が未有効です。${url} で有効化し、Play Console 側でこのサービスアカウントに「アプリ情報の閲覧」権限を付けてください`;
}

/* ------------------------------------------------------------------ *
 * ネットワーク
 * ------------------------------------------------------------------ */

const headers = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
});

/** メトリクスセットのメタ（鮮度）を読む。失敗しても null を返して落とさない */
export async function fetchFreshness(pkg, token, metricSetId = 'crashRateMetricSet') {
  try {
    const res = await fetch(`${REPORTING_BASE}/apps/${pkg}/${metricSetId}`, {
      headers: headers(token),
    });
    if (!res.ok) return null;
    return dailyFreshness(await res.json());
  } catch {
    return null;
  }
}

/**
 * 1 つのメトリクスセットを問い合わせる。
 * 戻り値は必ず `{ ok, rows, reason }` の形で、例外は投げない
 * （1 セットの失敗で全体を止めないため。呼び側は reason をそのまま報告に載せる）。
 */
export async function queryMetricSet({ pkg, token, metricSet, metrics, dimensions, start, end }) {
  try {
    const payload = {
      timelineSpec: { aggregationPeriod: 'DAILY', startTime: ymd(start), endTime: ymd(end) },
      metrics,
    };
    // 必須ディメンションのあるセット（slowStartRate の startType 等）は付けないと 400
    if (Array.isArray(dimensions) && dimensions.length > 0) payload.dimensions = dimensions;
    const res = await fetch(`${REPORTING_BASE}/apps/${pkg}/${metricSet}:query`, {
      method: 'POST',
      headers: headers(token),
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 403) {
      return { ok: false, rows: [], reason: forbiddenReason(body.error?.message) };
    }
    if (!res.ok) {
      const msg = body.error?.message ?? JSON.stringify(body);
      return { ok: false, rows: [], reason: `${res.status}: ${String(msg).slice(0, 200)}` };
    }
    return { ok: true, rows: (body.rows ?? []).map(foldRow), reason: null };
  } catch (e) {
    return { ok: false, rows: [], reason: String(e?.message ?? e).slice(0, 200) };
  }
}

/**
 * Vitals をまとめて取る。A 群の入口。
 * `metricSets` を渡さなければ METRIC_SETS 全部。
 */
export async function getVitals({ pkg, token, days = 7, metricSets = METRIC_SETS, now }) {
  const freshness = await fetchFreshness(pkg, token);
  const range = resolveRange(freshness, days, now ?? new Date());
  const sets = [];
  for (const set of metricSets) {
    const r = await queryMetricSet({
      pkg,
      token,
      metricSet: set.id,
      metrics: set.metrics,
      dimensions: set.dimensions,
      start: range.start,
      end: range.end,
    });
    sets.push({ ...set, ...r });
  }
  return {
    package: pkg,
    freshnessKnown: freshness !== null,
    start: ymdToIso(ymd(range.start)),
    end: ymdToIso(ymd(range.end)),
    days: range.days,
    sets,
  };
}
