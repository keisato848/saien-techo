jest.mock('../../db/client', () => ({
  isNativePlatform: false,
  getDb: jest.fn(),
  getExpoDb: jest.fn(),
}));

import {
  normalizeForSearch,
  removePlantingFtsEntry,
  searchPlantingsByFts,
  updatePlantingFtsIndex,
} from '../fts.service';

// 実 SQLite に対する検索そのものは planting.service.test 側で担保している。
// ここでは正規化の規則と、web での無害な素通りだけを見る。

describe('normalizeForSearch', () => {
  it('カタカナをひらがなに畳む', () => {
    expect(normalizeForSearch('トマト')).toBe('とまと');
  });

  it('英字は小文字に畳む', () => {
    expect(normalizeForSearch('Basil')).toBe('basil');
  });

  it('ひらがな・漢字はそのまま', () => {
    expect(normalizeForSearch('南の畝')).toBe('南の畝');
  });
});

describe('fts.service (web)', () => {
  it('searchPlantingsByFts は web では空配列', async () => {
    expect(await searchPlantingsByFts('トマト')).toEqual([]);
  });

  it('空の検索語も空配列', async () => {
    expect(await searchPlantingsByFts('   ')).toEqual([]);
  });

  it('update / remove は web では何もしないで戻る', async () => {
    await expect(
      updatePlantingFtsIndex('p1', 'トマト', 'とまと', 'アイコ', ['夏野菜']),
    ).resolves.not.toThrow();
    await expect(removePlantingFtsEntry('p1')).resolves.not.toThrow();
  });
});
