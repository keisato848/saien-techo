/**
 * 買い物リストを実 SQLite に対してテストする（R12 / WBS 2.7）。
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
  addGardenShoppingItem,
  addLowMaterialsToShoppingList,
  clearCheckedGardenShoppingItems,
  getGardenShoppingItems,
  removeGardenShoppingItem,
  setGardenShoppingItemChecked,
} from '../garden-shopping.service';
import { createMaterial, getMaterial } from '../material.service';
import type { SaveMaterialInput } from '../types';

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

function material(overrides: Partial<SaveMaterialInput> = {}): SaveMaterialInput {
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

const describeIfSqlite = isSqliteAvailable ? describe : describe.skip;

describeIfSqlite('garden-shopping.service (real SQLite)', () => {
  beforeEach(() => {
    mockHandles = createTestDb();
    seedFamily();
  });

  afterEach(() => mockHandles.close());

  describe('addGardenShoppingItem', () => {
    it('追加して一覧に出る', async () => {
      const id = await addGardenShoppingItem('支柱', '5本');
      const items = await getGardenShoppingItems();

      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id,
        name: '支柱',
        amount: '5本',
        checked: false,
        source: 'manual',
        materialId: null,
        materialCategory: null,
      });
    });

    it('前後の空白は落とす', async () => {
      await addGardenShoppingItem('  麻ひも  ', '   ');
      const items = await getGardenShoppingItems();

      expect(items[0].name).toBe('麻ひも');
      expect(items[0].amount).toBeNull();
    });

    it('空の名前では追加しない', async () => {
      expect(await addGardenShoppingItem('   ')).toBeNull();
      expect(await getGardenShoppingItems()).toEqual([]);
    });

    it('未チェックの同じ名前は増やさない', async () => {
      await addGardenShoppingItem('化成肥料');
      expect(await addGardenShoppingItem('化成肥料')).toBeNull();
      expect(await getGardenShoppingItems()).toHaveLength(1);
    });

    it('全角・カナ違いも同じ名前とみなす', async () => {
      await addGardenShoppingItem('ようりん');
      expect(await addGardenShoppingItem('ヨウリン')).toBeNull();
      expect(await getGardenShoppingItems()).toHaveLength(1);
    });

    it('買い終わったものは、もう一度追加できる', async () => {
      const id = await addGardenShoppingItem('化成肥料');
      await setGardenShoppingItemChecked(id as string, true);

      expect(await addGardenShoppingItem('化成肥料')).not.toBeNull();
      expect(await getGardenShoppingItems()).toHaveLength(2);
    });
  });

  describe('並び', () => {
    it('未チェックが先、それぞれ追加順', async () => {
      const first = await addGardenShoppingItem('支柱');
      await addGardenShoppingItem('麻ひも');
      await addGardenShoppingItem('培養土');
      await setGardenShoppingItemChecked(first as string, true);

      const names = (await getGardenShoppingItems()).map((it) => it.name);
      expect(names).toEqual(['麻ひも', '培養土', '支柱']);
    });
  });

  describe('addLowMaterialsToShoppingList', () => {
    it('閾値を割った資材だけをまとめて追加する', async () => {
      await createMaterial(
        material({ name: '化成肥料', quantity: 2, unit: 'kg', lowThreshold: 1 }),
      );
      await createMaterial(
        material({
          name: 'トマトの種',
          category: 'seed',
          quantity: 1,
          unit: '袋',
          lowThreshold: 2,
        }),
      );
      await createMaterial(
        material({ name: '培養土', category: 'soil', quantity: 3, unit: 'L', lowThreshold: 5 }),
      );

      expect(await addLowMaterialsToShoppingList()).toBe(2);

      const items = await getGardenShoppingItems();
      expect(items.map((it) => it.name).sort()).toEqual(['トマトの種', '培養土']);
      expect(items.every((it) => it.source === 'low')).toBe(true);
      expect(items.every((it) => it.materialId != null)).toBe(true);
    });

    it('分類を持ってくる（一覧で「肥料」などを添えられる）', async () => {
      await createMaterial(material({ quantity: 0, unit: 'kg', lowThreshold: 1 }));
      await addLowMaterialsToShoppingList();

      expect((await getGardenShoppingItems())[0].materialCategory).toBe('fertilizer');
    });

    it('2 回押しても増えない', async () => {
      await createMaterial(material({ quantity: 0, unit: 'kg', lowThreshold: 1 }));

      expect(await addLowMaterialsToShoppingList()).toBe(1);
      expect(await addLowMaterialsToShoppingList()).toBe(0);
      expect(await getGardenShoppingItems()).toHaveLength(1);
    });

    it('残りわずかが無ければ 0 件', async () => {
      await createMaterial(material({ quantity: 5, unit: 'kg', lowThreshold: 1 }));

      expect(await addLowMaterialsToShoppingList()).toBe(0);
      expect(await getGardenShoppingItems()).toEqual([]);
    });
  });

  describe('setGardenShoppingItemChecked', () => {
    it('チェックすると在庫が 1 増える', async () => {
      const materialId = await createMaterial(
        material({ quantity: 0, unit: 'kg', lowThreshold: 1 }),
      );
      await addLowMaterialsToShoppingList();
      const item = (await getGardenShoppingItems())[0];

      await setGardenShoppingItemChecked(item.id, true);

      expect((await getMaterial(materialId))?.quantity).toBe(1);
      expect((await getGardenShoppingItems())[0].checked).toBe(true);
    });

    it('外して付け直しても二重に増えない（レジ前の押し間違いで在庫が壊れない）', async () => {
      const materialId = await createMaterial(
        material({ quantity: 0, unit: 'kg', lowThreshold: 1 }),
      );
      await addLowMaterialsToShoppingList();
      const item = (await getGardenShoppingItems())[0];

      await setGardenShoppingItemChecked(item.id, true);
      await setGardenShoppingItemChecked(item.id, false);
      await setGardenShoppingItemChecked(item.id, true);

      expect((await getMaterial(materialId))?.quantity).toBe(1);
    });

    it('外しても在庫は減らさない（買った事実は消えない）', async () => {
      const materialId = await createMaterial(
        material({ quantity: 0, unit: 'kg', lowThreshold: 1 }),
      );
      await addLowMaterialsToShoppingList();
      const item = (await getGardenShoppingItems())[0];

      await setGardenShoppingItemChecked(item.id, true);
      await setGardenShoppingItemChecked(item.id, false);

      expect((await getMaterial(materialId))?.quantity).toBe(1);
      expect((await getGardenShoppingItems())[0].checked).toBe(false);
    });

    it('資材に紐づかない行では在庫を触らない', async () => {
      const materialId = await createMaterial(
        material({ quantity: 3, unit: 'kg', lowThreshold: 1 }),
      );
      const id = await addGardenShoppingItem('支柱');

      await setGardenShoppingItemChecked(id as string, true);

      expect((await getMaterial(materialId))?.quantity).toBe(3);
    });

    it('数量を持たない資材ではチェックしても落ちない', async () => {
      const materialId = await createMaterial(material({ name: '移植ごて', category: 'tool' }));
      const id = await addGardenShoppingItem('移植ごて', undefined, {
        source: 'low',
        materialId,
      });

      await setGardenShoppingItemChecked(id as string, true);

      expect((await getMaterial(materialId))?.quantity).toBeNull();
      expect((await getGardenShoppingItems())[0].checked).toBe(true);
    });

    it('存在しない行は何もしない', async () => {
      await expect(setGardenShoppingItemChecked('no-such-id', true)).resolves.toBeUndefined();
    });
  });

  describe('削除', () => {
    it('1 件消せる', async () => {
      const id = await addGardenShoppingItem('支柱');
      await removeGardenShoppingItem(id as string);

      expect(await getGardenShoppingItems()).toEqual([]);
    });

    it('買い終わったものだけまとめて消せる', async () => {
      const bought = await addGardenShoppingItem('支柱');
      await addGardenShoppingItem('麻ひも');
      await setGardenShoppingItemChecked(bought as string, true);

      expect(await clearCheckedGardenShoppingItems()).toBe(1);

      const items = await getGardenShoppingItems();
      expect(items.map((it) => it.name)).toEqual(['麻ひも']);
    });

    it('買い終わったものが無ければ 0 件', async () => {
      await addGardenShoppingItem('支柱');
      expect(await clearCheckedGardenShoppingItems()).toBe(0);
      expect(await getGardenShoppingItems()).toHaveLength(1);
    });
  });
});
