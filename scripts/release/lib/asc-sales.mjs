/**
 * App Store Connect の「売上とトレンド」レポート（`/v1/salesReports`）。
 *
 * **分析レポート API（asc-analytics.mjs）との違いが大事:**
 *   - こちらは**同期**。叩いたその場で gzip の TSV が返る。待ち時間ゼロ
 *   - ただし**表示回数・製品ページ閲覧数・ソース別の内訳は入っていない**。
 *     そこは分析レポート API でしか取れない
 *   - つまり「何人が入れたか」はこちら、「どこから来たか」はあちら
 *
 * 必要なのは **ベンダー番号**（App Store Connect の「支払いと財務レポート」の
 * 左上、法人名のすぐ下に薄いグレーで出ている数字）。API では取得できないので
 * 環境変数 `ASC_VENDOR_NUMBER` か `--vendor` で渡す。
 *
 * **月次は月が終わるまで 404 になる**（`There were no sales for the date specified.`）。
 * 当月を知りたいときは日次を 1 日ずつ取って足す。ここでは日次だけを使う。
 */
import { gunzipSync } from 'node:zlib';

import { ascToken, ASC_BASE } from './asc-api.mjs';

/**
 * Product Type Identifier。**混ぜて数えると DL 数が水増しになる。**
 * 出典: App Store Connect Help「Product type identifiers」。
 * 実測（2026-09-17）では 1 / 7 / 3 の 3 種が出た。
 */
export const PRODUCT_TYPES = {
  1: 'download',
  '1F': 'download',
  '1T': 'download',
  7: 'update',
  '7F': 'update',
  '7T': 'update',
  3: 'redownload',
  '3F': 'redownload',
  '3T': 'redownload',
};

export const KIND_LABEL = {
  download: '新規ダウンロード',
  update: 'アップデート',
  redownload: '再ダウンロード',
};

/* ------------------------------------------------------------------ *
 * 純粋関数（テスト対象）
 * ------------------------------------------------------------------ */

/** TSV をオブジェクトの配列へ。ヘッダが無ければ空配列 */
export function parseSalesTsv(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row = {};
    header.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

/** 区分の分類。知らない識別子は 'other' にして、黙って DL に混ぜない */
export function classifyProductType(id) {
  return PRODUCT_TYPES[String(id ?? '').trim()] ?? 'other';
}

/** 'YYYY-MM-DD' の配列を作る（end から遡って days 日分） */
export function dateRange(end, days) {
  const n = Number(days);
  const span = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
  const base = end instanceof Date && !Number.isNaN(end.getTime()) ? end : new Date();
  const out = [];
  for (let i = 0; i < span; i++) {
    const d = new Date(base.getTime() - i * 86400_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

/**
 * 行を 1 つの SKU について畳む。SKU を指定しなければ全部まとめる。
 * **区分ごとに分けて返す**（呼び側が足し合わせを選べるように）。
 */
export function summarizeSales(rows, { sku } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const target = sku
    ? list.filter((r) => String(r.SKU ?? '').toLowerCase() === String(sku).toLowerCase())
    : list;
  // **SKU が一致しないと全部 0 になる。** 「売れていない」と見分けが付かないので、
  // 行はあるのに 1 件も当たらなかったことを呼び側へ伝える
  const skuMismatch =
    Boolean(sku) && target.length === 0 && list.length > 0
      ? [...new Set(list.map((r) => r.SKU).filter(Boolean))]
      : null;

  const kinds = new Map();
  const byDevice = new Map();
  const byVersion = new Map();
  const byCountry = new Map();
  const unknownTypes = new Set();

  for (const r of target) {
    const units = Number(r.Units) || 0;
    const kind = classifyProductType(r['Product Type Identifier']);
    if (kind === 'other') unknownTypes.add(String(r['Product Type Identifier'] ?? '').trim());
    kinds.set(kind, (kinds.get(kind) ?? 0) + units);
    byCountry.set(
      r['Country Code'] || '不明',
      (byCountry.get(r['Country Code'] || '不明') ?? 0) + units,
    );
    if (kind !== 'download') continue;
    byDevice.set(r.Device || '不明', (byDevice.get(r.Device || '不明') ?? 0) + units);
    byVersion.set(r.Version || '不明', (byVersion.get(r.Version || '不明') ?? 0) + units);
  }

  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  return {
    rowCount: target.length,
    skuMismatch,
    downloads: kinds.get('download') ?? 0,
    updates: kinds.get('update') ?? 0,
    redownloads: kinds.get('redownload') ?? 0,
    other: kinds.get('other') ?? 0,
    unknownTypes: [...unknownTypes],
    byDevice: sortDesc(byDevice),
    byVersion: [...byVersion.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    byCountry: sortDesc(byCountry),
  };
}

/* ------------------------------------------------------------------ *
 * ネットワーク
 * ------------------------------------------------------------------ */

/**
 * 1 日分の売上レポート。
 * **データが無い日は 404 が正常**（その日は売上ゼロ）なので例外にしない。
 */
export async function fetchSalesDay({ vendorNumber, reportDate }) {
  const qs = new URLSearchParams({
    'filter[frequency]': 'DAILY',
    'filter[reportType]': 'SALES',
    'filter[reportSubType]': 'SUMMARY',
    'filter[vendorNumber]': String(vendorNumber),
    'filter[reportDate]': reportDate,
  });
  const res = await fetch(`${ASC_BASE}/salesReports?${qs}`, {
    headers: { Authorization: `Bearer ${ascToken()}`, Accept: 'application/a-gzip' },
  });
  if (res.status === 404) {
    // **「売上ゼロ」と「まだ生成されていない」を混ぜない。** Apple の日次レポートは
    // 翌日 5am PT まで存在せず、その 404 の本文は「not available yet」。
    // 混ぜると「7 日間で新規 0」と「5 日分しか見ていない」が同じ表示になる
    const body = await res.text().catch(() => '');
    const detail = (() => {
      try {
        return JSON.parse(body).errors?.[0]?.detail ?? body;
      } catch {
        return body;
      }
    })();
    if (/not available yet|not yet available|is not available/i.test(detail))
      return { ok: true, rows: [], pending: true, detail: String(detail).slice(0, 160) };
    return { ok: true, rows: [], empty: true };
  }
  if (!res.ok) {
    const body = await res.text();
    let detail = body.slice(0, 200);
    try {
      detail = JSON.parse(body).errors?.[0]?.detail ?? detail;
    } catch {
      /* JSON でなければ本文の先頭をそのまま使う */
    }
    return { ok: false, rows: [], reason: `HTTP ${res.status}: ${detail}` };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const text =
    buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b
      ? gunzipSync(buf).toString('utf8')
      : buf.toString('utf8');
  return { ok: true, rows: parseSalesTsv(text) };
}

/**
 * 期間分をまとめて取る。B 群の「何人が入れたか」の入口。
 * ベンダー番号が無ければ、取得を試みず理由を返す（403 を踏みに行かない）。
 */
export async function getSales({ vendorNumber, sku, days = 30, now }) {
  if (!vendorNumber)
    return {
      state: 'no-vendor',
      detail:
        'ベンダー番号が渡されていません。App Store Connect の「支払いと財務レポート」の左上（法人名のすぐ下）にある数字を、環境変数 ASC_VENDOR_NUMBER か --vendor で渡してください',
    };
  const dates = dateRange(now ?? new Date(), days);
  let rows = [];
  const failed = [];
  let emptyDays = 0;
  let pendingDays = 0;
  const counted = [];
  for (const d of dates) {
    const r = await fetchSalesDay({ vendorNumber, reportDate: d });
    if (!r.ok) {
      failed.push(`${d}: ${r.reason}`);
      continue;
    }
    if (r.pending) pendingDays += 1;
    else {
      counted.push(d);
      if (r.empty) emptyDays += 1;
    }
    rows = rows.concat(r.rows);
  }
  if (failed.length === dates.length)
    return { state: 'error', detail: failed[0] ?? '全ての日で取得に失敗しました' };
  const summary = summarizeSales(rows, { sku });
  if (summary.skuMismatch)
    return {
      state: 'sku-mismatch',
      detail: `SKU「${sku}」の行が 1 件も無い。レポートに出てきた SKU: ${summary.skuMismatch.join(', ')}。--sku で指定し直す`,
    };
  if (rows.length === 0 && pendingDays === dates.length)
    return {
      state: 'pending',
      detail: `指定した ${dates.length} 日ぶんがすべて未生成。Apple の日次レポートは翌日 5am PT まで出ない`,
    };
  return {
    state: 'ok',
    from: dates[0],
    // **未生成の日を期間の終わりにしない。** コメントだけそう書いて dates の末尾を
    // 返していた（2026-09-18 のレビュー指摘）
    to: counted.length > 0 ? counted[counted.length - 1] : dates[dates.length - 1],
    requestedTo: dates[dates.length - 1],
    days: dates.length,
    countedDays: dates.length - pendingDays - failed.length,
    emptyDays,
    pendingDays,
    failed,
    summary,
  };
}
