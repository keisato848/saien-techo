/**
 * 起動時の初期化のうち、**どこで落ちてよいか**の線引き（4.19 レビュー 26c / 39）。
 *
 * useDatabase 本体は `await import()` で expo-sqlite を遅延読み込みする（web 対策）。
 * jest は --experimental-vm-modules 無しでは動的 import を実行できないため、
 * フック全体ではなく、判断を持っている 2 つの関数を直に確かめる。
 */
import { createStopwatch, syncCropMasterSafely } from '../useDatabase';

describe('syncCropMasterSafely', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('成功すればそのまま通す', async () => {
    const sync = jest.fn(async () => {});

    await expect(syncCropMasterSafely(sync)).resolves.toBeUndefined();
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('失敗しても投げない（起動不能の「DB Error」全画面にしない）', async () => {
    const sync = jest.fn(async () => {
      throw new Error('no such column: tasks');
    });

    // ここで投げると useDatabase の catch が error を立て、アプリが起動しない。
    // 暦とガイドが古いままになるだけで、記録・収穫・写真は使える
    await expect(syncCropMasterSafely(sync)).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('作物マスターの同期に失敗しました'),
      'no such column: tasks',
    );
  });

  it('Error でないものを投げられても落ちない', async () => {
    const sync = jest.fn(async () => {
      throw 'なにか';
    });

    await expect(syncCropMasterSafely(sync)).resolves.toBeUndefined();
  });
});

describe('createStopwatch', () => {
  afterEach(() => jest.restoreAllMocks());

  it('開発ビルドでは各段の所要を出す（数字が無いまま最適化しないため）', () => {
    const logged: string[] = [];
    jest.spyOn(console, 'warn').mockImplementation((line: string) => {
      logged.push(String(line));
    });

    const lap = createStopwatch();
    lap('migrate');
    lap('crop-master');

    expect(logged).toHaveLength(2);
    expect(logged[0]).toMatch(/^\[db-init\] migrate: \d+ms \(累計 \d+ms\)$/);
    expect(logged[1]).toContain('[db-init] crop-master:');
  });
});
