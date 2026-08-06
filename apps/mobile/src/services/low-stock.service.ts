/**
 * Low-stock notification service (P3) — detect pantry items whose quantity has
 * fallen to/below their per-item threshold and raise ONE batched local
 * notification per calendar day. Thresholds are opt-in per item; with none set
 * nothing ever fires (and notification permission is never requested).
 * Triggered on app launch and after stock decreases (pantry stepper, meal
 * consumption, threshold edit). See docs/買い物リスト・在庫設計.md §5.5.
 */
import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { presentLowStockNotification } from './notification.service';
import { getPantryItems } from './pantry.service';
import type { PantryItem } from './types';
import { filterLowMaterials, getMaterials } from './material.service';

const NOTIFIED_DAY_KEY = 'low_stock_notified_day';
const MAX_NAMES_IN_BODY = 5;

/** Calendar-day key, e.g. "2026-07-02" (local time). */
function dayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Items at/below their threshold (both quantity and threshold must be set). */
export function filterLowStock(items: PantryItem[]): PantryItem[] {
  return items.filter(
    (it) =>
      it.quantity != null && it.lowStockThreshold != null && it.quantity <= it.lowStockThreshold,
  );
}

/** One batched message: 「卵、牛乳 ほか2件 の残りが少なくなっています。…」 */
export function buildLowStockBody(names: string[]): string {
  const head = names.slice(0, MAX_NAMES_IN_BODY).join('、');
  const rest = names.length > MAX_NAMES_IN_BODY ? ` ほか${names.length - MAX_NAMES_IN_BODY}件` : '';
  return `${head}${rest} の残りが少なくなっています。買い物リストに追加しましょう。`;
}

/**
 * Check the pantry and notify once per day if anything is low.
 * Returns true when a notification was actually presented. If the permission
 * is denied the day is NOT consumed, so it can retry once permission is granted.
 */
export async function checkAndNotifyLowStock(): Promise<boolean> {
  if (!isNativePlatform) return false;

  const low = filterLowStock(await getPantryItems());
  if (low.length === 0) return false;

  const today = dayKey();
  if ((await getAppMeta(NOTIFIED_DAY_KEY)) === today) return false;

  const id = await presentLowStockNotification(buildLowStockBody(low.map((it) => it.name)));
  if (id == null) return false;

  await setAppMeta(NOTIFIED_DAY_KEY, today);
  return true;
}

// ─── さいえん手帳の資材（R12 / WBS 2.6）─────────────────────────────────────

const MATERIAL_NOTIFIED_DAY_KEY = 'material_low_notified_day';

/**
 * 「化成肥料、培養土 ほか2件の残りが少なくなっています。」
 *
 * 名前と「の」の間に空白を入れない。資材名は「トマトの種（アイコ）」のように
 * 全角の閉じ括弧で終わることが多く、実機で見ると空白が間延びして見える。
 */
export function buildLowMaterialBody(names: string[]): string {
  const head = names.slice(0, MAX_NAMES_IN_BODY).join('、');
  const rest = names.length > MAX_NAMES_IN_BODY ? ` ほか${names.length - MAX_NAMES_IN_BODY}件` : '';
  return `${head}${rest}の残りが少なくなっています。買い足しておきましょう。`;
}

/**
 * 資材の残量を見て、1 日 1 回だけまとめて通知する（R12）。
 *
 * 都度鳴らさないのは、資材の買い足しが「週末にホームセンターへ行くとき」に
 * 起きるため。使うたびに鳴っても行動につながらず、通知が無視されるようになる。
 *
 * 権限が拒否されている場合は「その日を消費しない」。許可された時点で
 * もう一度試せるようにするため（だいどこの低在庫通知と同じ方針）。
 */
export async function checkAndNotifyLowMaterials(): Promise<boolean> {
  if (!isNativePlatform) return false;

  const low = filterLowMaterials(await getMaterials());
  if (low.length === 0) return false;

  const today = dayKey();
  if ((await getAppMeta(MATERIAL_NOTIFIED_DAY_KEY)) === today) return false;

  const id = await presentLowStockNotification(
    buildLowMaterialBody(low.map((it) => it.name)),
    '資材が少なくなっています',
  );
  if (id == null) return false;

  await setAppMeta(MATERIAL_NOTIFIED_DAY_KEY, today);
  return true;
}
