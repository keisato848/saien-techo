/**
 * 低在庫通知 — 資材（R12 / WBS 2.6）
 *
 * 資材の残量を見て、1 日 1 回だけまとめて通知する。
 * だいどこの食材在庫（pantry）側の低在庫通知は WBS 2.9c で削除した。
 *
 * 都度鳴らさないのは、資材の買い足しが「週末にホームセンターへ行くとき」に
 * 起きるため。使うたびに鳴っても行動につながらず、通知が無視されるようになる。
 */
import { isNativePlatform } from '../db/client';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { filterLowMaterials, getMaterials } from './material.service';
import { presentLowStockNotification } from './notification.service';

const MATERIAL_NOTIFIED_DAY_KEY = 'material_low_notified_day';
const MAX_NAMES_IN_BODY = 5;

/** その日を表す鍵。例 "2026-08-06"（端末ローカル） */
function dayKey(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

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
 * 権限が拒否されている場合は「その日を消費しない」。許可された時点で
 * もう一度試せるようにするため。
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
