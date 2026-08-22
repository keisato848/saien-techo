/**
 * 写真から栽培登録するための通行権（WBS 4.15 / #139）。
 *
 * ## 相談・収穫の枠とは混ぜない（ユーザー判断・2026-08-22）
 *
 * `usage.service` の枠は**インストールごとに 1 回の無料 + リワードの日次ボーナス**で、
 * AI 相談と収穫の読み取りが共有している。登録をそこへ混ぜると:
 *
 * - **初回の一括登録で無料 1 回を使い切り、相談を一度も試せなくなる**
 *   （#144 が狙った「最初の 1 回で価値を体験してもらう」が消える）
 * - 登録は株数ぶん撮るので、1 回の枠と粒度が合わない
 *
 * そこで**登録はすべてリワードで賄う**。無料枠は 1 回も消費しない。
 *
 * ## 視聴済みの回数は必ず残す
 *
 * AdMob は「開示した報酬を届ける」ことを求める。視聴後に処理が切れても
 * 回数が消えないよう **`app_meta` に残高として持つ**（#143 の paid 印と同じ考え方）。
 * 写真そのものは持たないので、#149 が挙げたバックアップ肥大の問題は起きない。
 *
 * 残高は**日付を含めない**。ボーナスと違って「今日のぶん」ではなく、
 * 見た動画に対して約束した枚数だからで、翌日に消えてはいけない。
 */
import { getAppMeta, setAppMeta } from './app-meta.service';

/** リワード 1 本で読み取れる枚数。 */
export const IDENTIFY_PER_REWARD = 5;

/**
 * 残高の上限。**貯め込みを防ぐ。** 上限が無いと動画だけ連続で見て
 * 残高を積み上げられ、後からまとめて叩かれるとサーバーのプールを一度に食う。
 */
export const IDENTIFY_CREDIT_CAP = 20;

/** 残高キー。**日付を含めない**（視聴に対する約束なので翌日も残す）。 */
const CREDIT_KEY = 'planting_identify_credits';

async function readCount(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** いま何枚読み取れるか。 */
export async function getIdentifyCredits(): Promise<number> {
  return Math.min(await readCount(CREDIT_KEY), IDENTIFY_CREDIT_CAP);
}

/**
 * リワード視聴 1 本ぶんを加算する。**`rewarded === true` を確認してから呼ぶこと**
 * （呼び出し側の責務。ここでは広告の状態を見ない — #143 の不変条件と同じ）。
 * 上限で頭打ちになった実際の残高を返す。
 */
export async function grantIdentifyCredits(): Promise<number> {
  const current = await getIdentifyCredits();
  const next = Math.min(current + IDENTIFY_PER_REWARD, IDENTIFY_CREDIT_CAP);
  await setAppMeta(CREDIT_KEY, String(next));
  return next;
}

/**
 * 1 枚ぶん消費する。残高が無ければ false を返して**何もしない**。
 *
 * **消費は送信の直前に行う。** 成功時消費にすると、途中でアプリを閉じて再開したときに
 * 同じ残高で何度も送れてしまう（#143 で踏んだ罠と同じ）。
 * 読み取れなかったぶんは戻さない代わりに、記録自体は手入力で必ずできる。
 */
export async function consumeIdentifyCredit(): Promise<boolean> {
  const current = await getIdentifyCredits();
  if (current <= 0) return false;
  await setAppMeta(CREDIT_KEY, String(current - 1));
  return true;
}

/** 検証用にリセットする（E2E・デバッグ）。 */
export async function resetIdentifyCredits(): Promise<void> {
  await setAppMeta(CREDIT_KEY, '0');
}
