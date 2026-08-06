/**
 * FTS5 全文検索 — 栽培の検索（R03）
 *
 * かつてはレシピ検索（recipe_fts）も同居していたが、WBS 2.9c で栽培専用にした。
 * recipe_fts テーブル自体は 2.9e（テーブル削除）まで残る。
 */
import { getExpoDb, isNativePlatform } from '../db/client';

/** カタカナ → ひらがな・小文字化。FTS への投入と検索で同じ関数を通す */
export function normalizeForSearch(text: string): string {
  // Katakana to hiragana
  const hiragana = text.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
  return hiragana.toLowerCase();
}

/** 栽培を FTS で検索し、planting_id の配列を返す */
export async function searchPlantingsByFts(query: string): Promise<string[]> {
  if (!isNativePlatform || !query.trim()) {
    return [];
  }
  const expoDb = getExpoDb();
  try {
    const rows = expoDb.getAllSync<{ planting_id: string }>(
      'SELECT planting_id FROM planting_fts WHERE planting_fts MATCH ?',
      [`${normalizeForSearch(query)}*`],
    );
    return rows.map((row) => row.planting_id);
  } catch {
    // FTS テーブルが未作成（マイグレーション前）
    return [];
  }
}

/** 1 件の栽培の FTS インデックスを更新する */
export async function updatePlantingFtsIndex(
  plantingId: string,
  cropName: string,
  cropNameReading: string | null,
  variety: string | null,
  tagNames: string[],
): Promise<void> {
  if (!isNativePlatform) return;
  const expoDb = getExpoDb();
  try {
    expoDb.runSync('DELETE FROM planting_fts WHERE planting_id = ?', [plantingId]);
    expoDb.runSync(
      'INSERT INTO planting_fts (planting_id, crop_name, crop_name_reading, variety, tag_names) VALUES (?, ?, ?, ?, ?)',
      [
        plantingId,
        normalizeForSearch(cropName),
        normalizeForSearch(cropNameReading ?? ''),
        normalizeForSearch(variety ?? ''),
        normalizeForSearch(tagNames.join(' ')),
      ],
    );
  } catch {
    // FTS テーブルが未作成
  }
}

/** 栽培を FTS インデックスから削除する */
export async function removePlantingFtsEntry(plantingId: string): Promise<void> {
  if (!isNativePlatform) return;
  const expoDb = getExpoDb();
  try {
    expoDb.runSync('DELETE FROM planting_fts WHERE planting_id = ?', [plantingId]);
  } catch {
    // FTS テーブルが未作成
  }
}
