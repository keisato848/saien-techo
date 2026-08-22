/**
 * 資材サービスを実 SQLite に対してテストする（R12 / WBS 2.6）。
 */
import {
  createTestDb,
  isSqliteAvailable,
  type TestDbHandles,
} from '../../test-support/sqlite-test-db';

// jest.mock のファクトリからは mock* で始まる変数しか参照できない
let mockHandles: TestDbHandles;

jest.mock('../../db/client', () => ({
  isNativePlatform: true,
  getDb: () => mockHandles.db,
  getExpoDb: () => mockHandles.expoDb,
}));

import {
  adjustMaterialQuantity,
  createMaterial,
  deleteMaterial,
  filterLowMaterials,
  getMaterial,
  getMaterials,
  MATERIAL_CATEGORIES,
  MATERIAL_CATEGORY_LABEL,
  updateMaterial,
} from '../material.service';
import type { MaterialItem, SaveMaterialInput } from '../types';

const FAMILY_ID = 'family-001';

function seedFamily(): void {
  const now = new Date().toISOString();
  mockHandles.expoDb.runSync(
    'INSERT INTO users (id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ['user-kei', 'テスト', now, now],
  );
  mockHandles.expoDb.runSync(
    'INSERT INTO families (id, name, owner_id, invite_code, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    [FAMILY_ID, 'テスト農園', 'user-kei', 'TEST01', now, now],
  );
}

function input(overrides: Partial<SaveMaterialInput> = {}): SaveMaterialInput {
  return {
    name: '化成肥料',
    category: 'fertilizer',
    quantity: null,
    unit: '',
    lowThreshold: null,
    note: '',
    ...overrides,
  };
}

/** filterLowMaterials は純関数なので DB 無しでも作れる形にしておく */
function item(overrides: Partial<MaterialItem> = {}): MaterialItem {
  return {
    id: 'm1',
    name: '化成肥料',
    category: 'fertilizer',
    quantity: 1,
    unit: 'kg',
    lowThreshold: 2,
    note: null,
    ...overrides,
  };
}

describe('MATERIAL_CATEGORY_LABEL', () => {
  it('すべての分類に日本語のラベルがある', () => {
    for (const category of MATERIAL_CATEGORIES) {
      expect(MATERIAL_CATEGORY_LABEL[category]).toBeTruthy();
    }
  });
});

describe('filterLowMaterials', () => {
  it('閾値以下なら拾う（ちょうど同数も含む）', () => {
    const low = filterLowMaterials([
      item({ id: 'under', quantity: 1, lowThreshold: 2 }),
      item({ id: 'equal', quantity: 2, lowThreshold: 2 }),
      item({ id: 'over', quantity: 3, lowThreshold: 2 }),
    ]);
    expect(low.map((it) => it.id)).toEqual(['under', 'equal']);
  });

  it('数量が無いものは対象外（道具を「残り不明」で鳴らさない）', () => {
    expect(filterLowMaterials([item({ quantity: null, lowThreshold: 2 })])).toEqual([]);
  });

  it('閾値が無いものは対象外（設定していない資材で鳴らさない）', () => {
    expect(filterLowMaterials([item({ quantity: 0, lowThreshold: null })])).toEqual([]);
  });

  it('0 も閾値割れとして拾う', () => {
    expect(filterLowMaterials([item({ quantity: 0, lowThreshold: 0 })])).toHaveLength(1);
  });
});

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('material.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => mockHandles.close());

  describe('createMaterial', () => {
    it('登録して取得できる', async () => {
      const id = await createMaterial(
        input({
          name: '化成肥料 8-8-8',
          quantity: 1.5,
          unit: 'kg',
          lowThreshold: 0.5,
          note: '開封済み',
        }),
      );
      const material = await getMaterial(id);

      expect(material).toEqual({
        id,
        name: '化成肥料 8-8-8',
        category: 'fertilizer',
        quantity: 1.5,
        unit: 'kg',
        lowThreshold: 0.5,
        note: '開封済み',
      });
    });

    it('前後の空白は落とす', async () => {
      const id = await createMaterial(
        input({ name: '  培養土  ', quantity: 10, unit: '  L  ', note: '   ' }),
      );
      const material = await getMaterial(id);

      expect(material?.name).toBe('培養土');
      expect(material?.unit).toBe('L');
      expect(material?.note).toBeNull();
    });

    it('数量が無ければ単位も閾値も落とす（通知できないので持たせない）', async () => {
      const id = await createMaterial(
        input({ name: '移植ごて', category: 'tool', quantity: null, unit: '本', lowThreshold: 1 }),
      );
      const material = await getMaterial(id);

      expect(material?.quantity).toBeNull();
      expect(material?.unit).toBeNull();
      expect(material?.lowThreshold).toBeNull();
    });

    it('数量 0 は「数量あり」として扱う（使い切った状態を残せる）', async () => {
      const id = await createMaterial(input({ quantity: 0, unit: 'kg', lowThreshold: 1 }));
      const material = await getMaterial(id);

      expect(material?.quantity).toBe(0);
      expect(material?.unit).toBe('kg');
      expect(material?.lowThreshold).toBe(1);
    });
  });

  describe('getMaterials', () => {
    it('分類順 → 名前順で返す', async () => {
      await createMaterial(input({ name: '培養土', category: 'soil' }));
      await createMaterial(input({ name: 'あぶら虫スプレー', category: 'pesticide' }));
      await createMaterial(input({ name: 'トマトの種', category: 'seed' }));
      await createMaterial(input({ name: '化成肥料', category: 'fertilizer' }));
      await createMaterial(input({ name: 'えひめAI', category: 'fertilizer' }));

      const names = (await getMaterials()).map((it) => it.name);
      // seed → fertilizer → pesticide → soil の順。肥料の中は名前順
      expect(names).toEqual(['トマトの種', 'えひめAI', '化成肥料', 'あぶら虫スプレー', '培養土']);
    });

    it('分類でしぼれる', async () => {
      await createMaterial(input({ name: '化成肥料', category: 'fertilizer' }));
      await createMaterial(input({ name: '培養土', category: 'soil' }));

      const soil = await getMaterials('soil');
      expect(soil.map((it) => it.name)).toEqual(['培養土']);
    });

    it('1 件も無ければ空配列', async () => {
      expect(await getMaterials()).toEqual([]);
    });
  });

  describe('updateMaterial', () => {
    it('内容を書き換えられる', async () => {
      const id = await createMaterial(input({ name: '化成肥料', quantity: 2, unit: 'kg' }));
      await updateMaterial(
        id,
        input({
          name: '有機肥料',
          category: 'fertilizer',
          quantity: 5,
          unit: '袋',
          lowThreshold: 1,
        }),
      );

      const material = await getMaterial(id);
      expect(material?.name).toBe('有機肥料');
      expect(material?.quantity).toBe(5);
      expect(material?.unit).toBe('袋');
      expect(material?.lowThreshold).toBe(1);
    });

    it('数量を消したら単位と閾値も消える', async () => {
      const id = await createMaterial(input({ quantity: 2, unit: 'kg', lowThreshold: 1 }));
      await updateMaterial(id, input({ quantity: null, unit: 'kg', lowThreshold: 1 }));

      const material = await getMaterial(id);
      expect(material?.quantity).toBeNull();
      expect(material?.unit).toBeNull();
      expect(material?.lowThreshold).toBeNull();
    });
  });

  describe('adjustMaterialQuantity', () => {
    it('足し引きできる', async () => {
      const id = await createMaterial(input({ quantity: 3, unit: '袋' }));

      expect(await adjustMaterialQuantity(id, -1)).toBe(2);
      expect((await getMaterial(id))?.quantity).toBe(2);
      expect(await adjustMaterialQuantity(id, 1)).toBe(3);
    });

    it('0 未満にはしない', async () => {
      const id = await createMaterial(input({ quantity: 0.5, unit: '袋' }));

      expect(await adjustMaterialQuantity(id, -1)).toBe(0);
      expect((await getMaterial(id))?.quantity).toBe(0);
    });

    it('小数の誤差を丸める（0.1 きざみでも 0.30000000000000004 にしない）', async () => {
      const id = await createMaterial(input({ quantity: 0.2, unit: 'kg' }));
      expect(await adjustMaterialQuantity(id, 0.1)).toBe(0.3);
    });

    it('数量を持たない資材には何もしない', async () => {
      const id = await createMaterial(input({ category: 'tool', quantity: null }));

      expect(await adjustMaterialQuantity(id, -1)).toBeNull();
      expect((await getMaterial(id))?.quantity).toBeNull();
    });

    it('存在しない資材なら null', async () => {
      expect(await adjustMaterialQuantity('no-such-id', -1)).toBeNull();
    });
  });

  describe('deleteMaterial', () => {
    it('消せる', async () => {
      const id = await createMaterial(input());
      await deleteMaterial(id);

      expect(await getMaterial(id)).toBeNull();
      expect(await getMaterials()).toEqual([]);
    });
  });

  describe('低在庫の判定（保存した値で通る）', () => {
    it('閾値を割った資材だけを拾う', async () => {
      await createMaterial(input({ name: '化成肥料', quantity: 2, unit: 'kg', lowThreshold: 0.5 }));
      const seedId = await createMaterial(
        input({ name: 'トマトの種', category: 'seed', quantity: 1, unit: '袋', lowThreshold: 2 }),
      );
      await createMaterial(input({ name: '移植ごて', category: 'tool', quantity: null }));

      const low = filterLowMaterials(await getMaterials());
      expect(low.map((it) => it.id)).toEqual([seedId]);
    });

    it('使って減らすと閾値割れになる', async () => {
      const id = await createMaterial(
        input({ name: '化成肥料', quantity: 1, unit: 'kg', lowThreshold: 0.5 }),
      );
      expect(filterLowMaterials(await getMaterials())).toEqual([]);

      await adjustMaterialQuantity(id, -0.5);
      expect(filterLowMaterials(await getMaterials()).map((it) => it.id)).toEqual([id]);
    });
  });
});
