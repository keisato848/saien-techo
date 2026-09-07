/**
 * Database initialization hook
 * Runs migrations and seeds on app startup (native)
 * On web, skips DB init and uses mock data
 */
import { useEffect, useState } from 'react';

import { initDatabase, isNativePlatform } from '../db/client';

/**
 * 起動コストの計測点（4.19 レビュー 39）。
 * **数字が無いまま最適化しない**ため、開発ビルドだけ各段の所要を出す。
 * 本番では `__DEV__` が false になり、計測ごと落ちる。
 */
export function createStopwatch(): (label: string) => void {
  if (!__DEV__) return () => {};
  const start = Date.now();
  let previous = start;
  return (label: string) => {
    const now = Date.now();
    // console.log は lint で禁じられている（no-console の allow は warn/error）
    console.warn(`[db-init] ${label}: ${now - previous}ms (累計 ${now - start}ms)`);
    previous = now;
  };
}

/**
 * マスター同期の失敗を**アプリの起動失敗にしない**（4.19 レビュー 26c）。
 *
 * 暦とガイドが前回の内容のまま古くなるだけで、記録・収穫・写真は使える。
 * ここで投げると起動不能の「DB Error」全画面に到達してしまう。
 * syncCropMaster はトランザクションなので、失敗しても版は上がらず次の起動でやり直す。
 */
export async function syncCropMasterSafely(sync: () => Promise<void>): Promise<void> {
  try {
    await sync();
  } catch (e) {
    console.error(
      '作物マスターの同期に失敗しました（暦とガイドは前回の内容のまま）:',
      e instanceof Error ? e.message : e,
    );
  }
}

export function useDatabase() {
  // On web, DB init is skipped, so start as ready to avoid a flash on navigation
  const [isReady, setIsReady] = useState(!isNativePlatform);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        if (isNativePlatform) {
          const lap = createStopwatch();
          await initDatabase();
          lap('open');

          const { getDb, getExpoDb } = await import('../db/client');
          const { ensureLocalIdentity, runMigrations, seedDatabase, syncCropMaster } =
            await import('../db/migrate');

          runMigrations(getExpoDb());
          lap('migrate');
          await ensureLocalIdentity(getDb());
          lap('identity');

          // 作物マスター（栽培暦）はサンプルと違い本番でも常に同期する（WBS 3.1）
          await syncCropMasterSafely(() => syncCropMaster(getDb()));
          lap('crop-master');

          await seedDatabase(getDb());
          lap('seed');

          // 作物マスターを入れた**後**に、手入力で登録された栽培を暦へ紐づけ直す。
          // 保存時の照合（crop-match.service）を足しても既存の行は null のままで、
          // 「つぎの作業」も進行帯も出ないままになるため
          const { backfillPlantingCropIds } = await import('../services/crop-match.service');
          await backfillPlantingCropIds();
          lap('backfill');
        }
        // Web: no DB, screens use mock data
        setIsReady(true);
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Unknown database error';
        setError(message);
        console.error('Database init failed:', message);
      }
    }
    void init();
  }, []);

  return { isReady, error, isNativePlatform };
}
