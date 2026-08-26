/**
 * Database initialization hook
 * Runs migrations and seeds on app startup (native)
 * On web, skips DB init and uses mock data
 */
import { useEffect, useState } from 'react';

import { initDatabase, isNativePlatform } from '../db/client';

export function useDatabase() {
  // On web, DB init is skipped, so start as ready to avoid a flash on navigation
  const [isReady, setIsReady] = useState(!isNativePlatform);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      try {
        if (isNativePlatform) {
          await initDatabase();

          const { getDb, getExpoDb } = await import('../db/client');
          const { ensureLocalIdentity, runMigrations, seedDatabase, syncCropMaster } =
            await import('../db/migrate');

          runMigrations(getExpoDb());
          await ensureLocalIdentity(getDb());
          // 作物マスター（栽培暦）はサンプルと違い本番でも常に同期する（WBS 3.1）
          await syncCropMaster(getDb());
          await seedDatabase(getDb());

          // 作物マスターを入れた**後**に、手入力で登録された栽培を暦へ紐づけ直す。
          // 保存時の照合（crop-match.service）を足しても既存の行は null のままで、
          // 「つぎの作業」も進行帯も出ないままになるため
          const { backfillPlantingCropIds } = await import('../services/crop-match.service');
          await backfillPlantingCropIds();
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
