/**
 * Freemium usage service — 無料枠とリワード広告の通行権（AI 相談・写真の読み取り共用）。
 *
 * ## 無料枠は「インストール時に 1 回」（日次ではない・2026-08-21 決定）
 *
 * 以前は**カレンダー日ごとに 1 回**だった。これは赤字だった:
 * 相談は **¥0.35/回**、読み取りは **¥0.07/回**で 5 倍の開きがあり、枠は共用なので
 * ユーザーがその日の 1 回を相談に使えば ¥0.35 が出ていく。つまり
 * **無料枠は実質「一番高い呼び出し」の値段で課金されていた**（毎日使われて ¥10.5/人・月）。
 * 無料ユーザー 1 人あたりの広告収入では賄えない。
 *
 * インストール時 1 回にすると、**それ以降のすべての推論が広告で賄われる**:
 * 相談はリワード 1 本で 1 回（¥0.35 に対し報酬 ¥1〜3）、
 * 読み取りはリワード 1 本で 10 枚（¥0.7 に対し ¥1〜3）。どちらも黒字側。
 * 「最初の 1 回で価値を体験してもらう」狙い（#144）は 1 回きりでも成立する。
 *
 * ## 生涯枠と日次ボーナスを 1 本の引き算に混ぜないこと
 *
 * `limit - used` で一括計算すると壊れる。`used` が生涯で増え続けるのに
 * ボーナスは毎日 0 に戻るので、**広告を見ても remaining が 0 のまま**になる。
 * そこで**無料ぶん（生涯）とボーナスぶん（その日）を別々に数え**、
 * 消費は無料ぶんから先に充てる。
 */
import { FREE_LIFETIME_LIMIT_CONFIG } from '../config';
import { isAdRewardAvailable } from './ad-reward.service';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { hasUserApiKey } from './byok.service';
import { isPremium } from './entitlement.service';

/** 無料で使える回数。**インストールごとに 1 回**（ビルド時に変更可・既定 1）。 */
export const FREE_LIFETIME_LIMIT = FREE_LIFETIME_LIMIT_CONFIG;
/** リワード広告で 1 日に足せる回数の上限。 */
export const AD_BONUS_DAILY_LIMIT = 3;

/**
 * 無料ぶんの消費数。**日付を含めない**（= 生涯で 1 つ）。
 * 旧実装の日付つきキー（`ai_photo_recipe_usage:2026-08-21`）はそのまま残るが読まない。
 * 既存ユーザーはこのキーが空なので、更新直後に 1 回だけ無料枠が戻る（許容する）。
 */
const FREE_USED_KEY = 'ai_photo_recipe_usage:lifetime';
/** その日に広告で獲得した回数。 */
const AD_BONUS_GRANTED_KEY_PREFIX = 'ai_photo_recipe_ad_bonus:';
/** その日にボーナスから消費した回数。 */
const AD_BONUS_USED_KEY_PREFIX = 'ai_photo_recipe_ad_used:';

export interface FreemiumStatus {
  isPremium: boolean;
  /** Unlimited via the user's own Gemini key (BYOK). */
  isByok: boolean;
  /** 使った回数（無料ぶん + その日のボーナスぶん）。premium は 0。 */
  used: number;
  /** 使える回数の合計。premium は Infinity。 */
  limit: number;
  /** あと何回使えるか。premium は Infinity。 */
  remaining: number;
  canInfer: boolean;
  /** リワードを勧めてよいか: 残 0・広告が出せる・その日の上限に未達。 */
  canWatchAdForMore: boolean;
  /** その日に広告で獲得した回数。 */
  adBonusGranted: number;
  adBonusLimit: number;
  /** 無料ぶんが残っているか（UI の文言を「今日は」と言い分けるため）。 */
  hasFreeLeft: boolean;
}

/** Calendar-day key, e.g. "2026-06-28". */
export function currentDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function remainingFree(used: number, limit: number = FREE_LIFETIME_LIMIT): number {
  return Math.max(0, limit - used);
}

/**
 * (premium, 無料ぶんの消費, その日のボーナス獲得/消費, 広告の可否) から通行権を決める純関数。
 *
 * **無料ぶんとボーナスぶんは別々に残数を出して足す。** 引き算 1 本にまとめると、
 * 生涯で増え続ける `freeUsed` が毎日リセットされるボーナスを食い潰す。
 */
export function deriveFreemiumStatus(
  premium: boolean,
  freeUsed: number,
  adBonusGranted = 0,
  adBonusUsed = 0,
  adAvailable = false,
  byok = false,
  freeLimit: number = FREE_LIFETIME_LIMIT,
  bonusLimit: number = AD_BONUS_DAILY_LIMIT,
): FreemiumStatus {
  if (premium || byok) {
    return {
      isPremium: premium,
      isByok: byok && !premium,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
      remaining: Number.POSITIVE_INFINITY,
      canInfer: true,
      canWatchAdForMore: false,
      adBonusGranted: 0,
      adBonusLimit: bonusLimit,
      hasFreeLeft: false,
    };
  }
  const grantedCapped = Math.min(Math.max(0, adBonusGranted), bonusLimit);
  const freeLeft = Math.max(0, freeLimit - Math.max(0, freeUsed));
  const bonusLeft = Math.max(0, grantedCapped - Math.max(0, adBonusUsed));
  const remaining = freeLeft + bonusLeft;
  return {
    isPremium: false,
    isByok: false,
    used: Math.max(0, freeUsed) + Math.max(0, adBonusUsed),
    limit: freeLimit + grantedCapped,
    remaining,
    canInfer: remaining > 0,
    canWatchAdForMore: adAvailable && remaining === 0 && grantedCapped < bonusLimit,
    adBonusGranted: grantedCapped,
    adBonusLimit: bonusLimit,
    hasFreeLeft: freeLeft > 0,
  };
}

async function readCount(key: string): Promise<number> {
  const raw = await getAppMeta(key);
  const parsed = raw ? Number(raw) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** 無料ぶんを何回使ったか（生涯）。 */
export async function getFreeUsage(): Promise<number> {
  return readCount(FREE_USED_KEY);
}

export async function getAdBonusGranted(date: Date = new Date()): Promise<number> {
  return readCount(AD_BONUS_GRANTED_KEY_PREFIX + currentDayKey(date));
}

/** その日にボーナスから消費した回数。 */
export async function getAdBonusUsed(date: Date = new Date()): Promise<number> {
  return readCount(AD_BONUS_USED_KEY_PREFIX + currentDayKey(date));
}

/**
 * 通行権を 1 回ぶん消費する。**無料ぶんから先に充てる。**
 * 枠が残っていなければ何もしない（呼び出し側が先に `canInfer` を見ている前提）。
 */
export async function incrementUsage(date: Date = new Date()): Promise<void> {
  const freeUsed = await getFreeUsage();
  if (freeUsed < FREE_LIFETIME_LIMIT) {
    await setAppMeta(FREE_USED_KEY, String(freeUsed + 1));
    return;
  }
  const [granted, used] = await Promise.all([getAdBonusGranted(date), getAdBonusUsed(date)]);
  if (used >= Math.min(granted, AD_BONUS_DAILY_LIMIT)) return;
  await setAppMeta(AD_BONUS_USED_KEY_PREFIX + currentDayKey(date), String(used + 1));
}

/** Grant one ad-unlocked extra use (capped at AD_BONUS_DAILY_LIMIT). Returns the new total. */
export async function grantAdBonus(date: Date = new Date()): Promise<number> {
  const current = await getAdBonusGranted(date);
  if (current >= AD_BONUS_DAILY_LIMIT) return current;
  const next = current + 1;
  await setAppMeta(AD_BONUS_GRANTED_KEY_PREFIX + currentDayKey(date), String(next));
  return next;
}

/** Combined premium + quota + ad status for the gate / UI. */
export async function getFreemiumStatus(): Promise<FreemiumStatus> {
  const [premium, freeUsed, adBonusGranted, adBonusUsed, byok] = await Promise.all([
    isPremium(),
    getFreeUsage(),
    getAdBonusGranted(),
    getAdBonusUsed(),
    hasUserApiKey(),
  ]);
  return deriveFreemiumStatus(
    premium,
    freeUsed,
    adBonusGranted,
    adBonusUsed,
    isAdRewardAvailable(),
    byok,
  );
}

/**
 * Count one successful cloud inference against the quota.
 * No-op for premium and BYOK users (BYOK uses the user's own key/quota).
 * Call only when the AI (our managed server) actually returned a draft.
 */
export async function recordCloudInference(): Promise<void> {
  if (await isPremium()) return;
  if (await hasUserApiKey()) return;
  await incrementUsage();
}
