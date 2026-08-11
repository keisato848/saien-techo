/**
 * 起動広告サービス — §8.2 / WBS 3.7
 *
 * 起動時に 1 回だけ呼ばれ、頻度判定（utils/appOpenAdFrequency）に通してから
 * 表示する。状態は app_meta に JSON 1 件で持つ（テーブルを増やすほどではない）。
 *
 * **例外を投げない。** 起動広告は出なくてもアプリは使えるので、
 * ここで throw して起動が止まるのが最悪の失敗。すべて握って理由を返す。
 */
import { Platform } from 'react-native';

import { ADMOB_ENABLED } from '../config';
import {
  type AppOpenAdDecision,
  type AppOpenAdState,
  decideAppOpenAd,
  recordAppOpenAdShown,
} from '../utils/appOpenAdFrequency';
import { getAppMeta, setAppMeta } from './app-meta.service';
import { AdMobAppOpenAdProvider } from './app-open-ad.admob';
import type { AppOpenAdProvider } from './app-open-ad.types';

const STATE_KEY = 'app_open_ad_state';

const isNative = Platform.OS === 'ios' || Platform.OS === 'android';

/** 広告を出さない構成のときの provider（同意 UI も出さない） */
export class StubAppOpenAdProvider implements AppOpenAdProvider {
  async prepare(): Promise<{ canRequestAds: boolean }> {
    return { canRequestAds: false };
  }
  async showAppOpenAd(): Promise<boolean> {
    return false;
  }
  async isPrivacyOptionsRequired(): Promise<boolean> {
    return false;
  }
  async showPrivacyOptionsForm(): Promise<void> {
    // no-op
  }
}

let cachedProvider: AppOpenAdProvider | null = null;
/**
 * テストで provider を注入したか。
 * ADMOB_ENABLED はビルド時に焼き込まれるフラグでテストから変えられないため、
 * **provider を注入したこと自体を「広告が配線されている」とみなす**。
 * これが無いと、注入したのに常に disabled で弾かれて配線を確かめられない。
 */
let providerInjectedForTesting = false;

/** 実 AdMob を使う構成か（env フラグ + ネイティブ） */
export function isAppOpenAdConfigured(): boolean {
  return providerInjectedForTesting || (isNative && ADMOB_ENABLED);
}

export function getAppOpenAdProvider(): AppOpenAdProvider {
  if (!cachedProvider) {
    cachedProvider = isAppOpenAdConfigured()
      ? new AdMobAppOpenAdProvider()
      : new StubAppOpenAdProvider();
  }
  return cachedProvider;
}

/** テスト用: 記憶した provider を差し替える（null で元に戻す） */
export function resetAppOpenAdProviderForTesting(provider: AppOpenAdProvider | null): void {
  cachedProvider = provider;
  providerInjectedForTesting = provider !== null;
}

const EMPTY_STATE: AppOpenAdState = { firstLaunchAt: null, lastShownAt: null, shownToday: 0 };

export async function readAppOpenAdState(): Promise<AppOpenAdState> {
  try {
    const raw = await getAppMeta(STATE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_STATE;
    const value = parsed as Partial<AppOpenAdState>;
    return {
      firstLaunchAt: typeof value.firstLaunchAt === 'string' ? value.firstLaunchAt : null,
      lastShownAt: typeof value.lastShownAt === 'string' ? value.lastShownAt : null,
      shownToday: Number.isInteger(value.shownToday) ? (value.shownToday as number) : 0,
    };
  } catch {
    return EMPTY_STATE;
  }
}

async function writeAppOpenAdState(state: AppOpenAdState): Promise<void> {
  try {
    await setAppMeta(STATE_KEY, JSON.stringify(state));
  } catch {
    // 保存できなくても広告の表示自体は済んでいる。次回の判定が甘くなるだけ
  }
}

/**
 * 初回起動時刻を記録する（まだ無ければ）。
 * 起動広告の「入れた直後は出さない」猶予の起点になるので、
 * **広告を出すかに関わらず**毎回呼ぶ。
 */
export async function ensureFirstLaunchRecorded(now: Date = new Date()): Promise<AppOpenAdState> {
  const state = await readAppOpenAdState();
  if (state.firstLaunchAt) return state;
  const next: AppOpenAdState = { ...state, firstLaunchAt: now.toISOString() };
  await writeAppOpenAdState(next);
  return next;
}

export interface MaybeShowResult {
  shown: boolean;
  reason: AppOpenAdDecision['reason'] | 'load-failed';
}

/**
 * 起動時に 1 回だけ呼ぶ。出せる条件がそろっていれば起動広告を出す。
 *
 * `onboarding` は呼び出し側から渡す（地域未設定＝初回体験の最中）。
 * この層で設定を読みに行くと、広告のために起動を待たせることになる。
 */
export async function maybeShowAppOpenAd(
  options: { onboarding: boolean },
  now: Date = new Date(),
): Promise<MaybeShowResult> {
  try {
    const state = await ensureFirstLaunchRecorded(now);

    // 同意を先に解決する。ここで canRequestAds が false なら広告は要求しない
    const provider = getAppOpenAdProvider();
    const { canRequestAds } = await provider.prepare();

    const decision = decideAppOpenAd(
      {
        enabled: isAppOpenAdConfigured(),
        canRequestAds,
        onboarding: options.onboarding,
        state,
      },
      now,
    );
    if (!decision.show) return { shown: false, reason: decision.reason };

    const shown = await provider.showAppOpenAd();
    if (!shown) return { shown: false, reason: 'load-failed' };

    await writeAppOpenAdState(recordAppOpenAdShown(state, now));
    return { shown: true, reason: 'ok' };
  } catch {
    // 起動広告のために起動が止まるのが最悪。握って進める
    return { shown: false, reason: 'load-failed' };
  }
}
