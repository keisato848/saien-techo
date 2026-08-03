/**
 * FTS5 full-text search service
 * Provides Japanese-aware search with kana normalization
 */
import { getExpoDb, isNativePlatform } from '../db/client';

/**
 * Search recipes using FTS5 MATCH on native, client-side filter on web.
 * Returns recipe IDs that match the query.
 */
export async function searchByFts(query: string): Promise<string[]> {
  if (!isNativePlatform || !query.trim()) {
    return [];
  }

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();

    // Normalize and create prefix search term
    const normalized = normalizeForSearch(query.trim());
    const searchTerm = `${normalized}*`;

    const rows = expoDb.getAllSync<{ recipe_id: string }>(
      'SELECT recipe_id FROM recipe_fts WHERE recipe_fts MATCH ?',
      [searchTerm],
    );

    return rows.map((r) => r.recipe_id);
  } catch {
    // FTS table may not exist
    return [];
  }
}

/**
 * Update the FTS index for a single recipe.
 * Called after create/update/delete operations.
 */
export async function updateFtsIndex(
  recipeId: string,
  title: string,
  titleReading: string,
  ingredientNames: string[],
): Promise<void> {
  if (!isNativePlatform) return;

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();

    // Delete existing
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);

    // Insert updated
    const ingText = ingredientNames.join(' ');
    expoDb.runSync(
      'INSERT INTO recipe_fts (recipe_id, title, title_reading, ingredient_names) VALUES (?, ?, ?, ?)',
      [recipeId, title, titleReading, ingText],
    );
  } catch {
    // FTS table may not exist yet
  }
}

/**
 * Remove a recipe from the FTS index.
 */
export async function removeFtsEntry(recipeId: string): Promise<void> {
  if (!isNativePlatform) return;

  try {
    const { getExpoDb } = await import('../db/client');
    const expoDb = getExpoDb();
    expoDb.runSync('DELETE FROM recipe_fts WHERE recipe_id = ?', [recipeId]);
  } catch {
    // FTS table may not exist
  }
}

/**
 * Normalize text for FTS search: katakana -> hiragana, lowercase
 */
/** カタカナ → ひらがな・小文字化。FTS への投入と検索で同じ関数を通す */
export function normalizeForSearch(text: string): string {
  // Katakana to hiragana
  const hiragana = text.replace(/[\u30A1-\u30F6]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
  return hiragana.toLowerCase();
}

// ─── 栽培（さいえん手帳 / R03）─────────────────────────────────────────────
// recipe_fts と同じ方式。正規化（カタカナ → ひらがな・小文字化）は共通で使う。

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
