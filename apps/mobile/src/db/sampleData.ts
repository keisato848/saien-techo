/**
 * サンプルデータ投入フラグ（ビルド時焼き込み）。
 * だいどこのシード ID 判定（isSeedRecipeId ほか）は WBS 2.9c で削除した。
 */
const SAMPLE_DATA_FLAG = 'EXPO_PUBLIC_ENABLE_SAMPLE_DATA';

export function isSampleDataEnabled(): boolean {
  const flag = process.env.EXPO_PUBLIC_ENABLE_SAMPLE_DATA ?? process.env[SAMPLE_DATA_FLAG];
  return (
    flag === '1' ||
    flag === 'true' ||
    process.env.NODE_ENV === 'test' ||
    typeof process.env.JEST_WORKER_ID === 'string'
  );
}
