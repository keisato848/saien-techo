/**
 * 起動広告サービス（§8.2 / WBS 3.7）。
 *
 * 頻度の境界は utils/appOpenAdFrequency のテストで担保。ここで見るのは
 * **配線**: 同意を先に解決しているか、出したときだけ状態を書くか、
 * そして**何があっても起動を止めないか**。
 */
const mockMeta = new Map<string, string>();
jest.mock('../app-meta.service', () => ({
  getAppMeta: (key: string) => Promise.resolve(mockMeta.get(key) ?? null),
  setAppMeta: (key: string, value: string) => {
    mockMeta.set(key, value);
    return Promise.resolve();
  },
}));

// 実 AdMob 経路に入らないよう、SDK を読む兄弟モジュールは丸ごと差し替える
jest.mock('../app-open-ad.admob', () => ({
  AdMobAppOpenAdProvider: class {
    async prepare() {
      return { canRequestAds: true };
    }
    async showAppOpenAd() {
      return true;
    }
    async isPrivacyOptionsRequired() {
      return false;
    }
    async showPrivacyOptionsForm() {
      // no-op
    }
  },
}));

import type { AppOpenAdProvider } from '../app-open-ad.types';
import {
  ensureFirstLaunchRecorded,
  maybeShowAppOpenAd,
  readAppOpenAdState,
  resetAppOpenAdProviderForTesting,
} from '../app-open-ad.service';

const NOW = new Date(2026, 7, 10, 12);
const LONG_AGO = new Date(2026, 7, 1, 9).toISOString();

function provider(overrides: Partial<AppOpenAdProvider> = {}): AppOpenAdProvider {
  return {
    prepare: () => Promise.resolve({ canRequestAds: true }),
    showAppOpenAd: () => Promise.resolve(true),
    isPrivacyOptionsRequired: () => Promise.resolve(false),
    showPrivacyOptionsForm: () => Promise.resolve(),
    ...overrides,
  };
}

beforeEach(() => {
  mockMeta.clear();
  resetAppOpenAdProviderForTesting(null);
});

describe('ensureFirstLaunchRecorded', () => {
  it('初回だけ時刻を記録する', async () => {
    const first = await ensureFirstLaunchRecorded(NOW);
    expect(first.firstLaunchAt).toBe(NOW.toISOString());

    const later = new Date(2026, 7, 11, 9);
    const second = await ensureFirstLaunchRecorded(later);
    expect(second.firstLaunchAt).toBe(NOW.toISOString());
  });
});

describe('maybeShowAppOpenAd', () => {
  it('猶予中は出さない（入れた直後）', async () => {
    resetAppOpenAdProviderForTesting(provider());

    // 状態が空＝この起動が初回。初回起動をこの瞬間に記録するので必ず猶予に入る
    const result = await maybeShowAppOpenAd({ onboarding: false }, NOW);

    expect(result).toEqual({ shown: false, reason: 'within-grace' });
  });

  it('広告が配線されていなければ出さない', async () => {
    // provider を注入しない＝ ADMOB_ENABLED も false の既定構成
    const result = await maybeShowAppOpenAd({ onboarding: false }, NOW);
    expect(result.reason).toBe('disabled');
  });

  it('オンボーディング中は出さない', async () => {
    mockMeta.set(
      'app_open_ad_state',
      JSON.stringify({ firstLaunchAt: LONG_AGO, lastShownAt: null, shownToday: 0 }),
    );
    resetAppOpenAdProviderForTesting(provider());

    const result = await maybeShowAppOpenAd({ onboarding: true }, NOW);
    expect(result.reason).toBe('onboarding');
  });

  it('同意が取れていなければ広告を要求しない', async () => {
    mockMeta.set(
      'app_open_ad_state',
      JSON.stringify({ firstLaunchAt: LONG_AGO, lastShownAt: null, shownToday: 0 }),
    );
    const show = jest.fn(() => Promise.resolve(true));
    resetAppOpenAdProviderForTesting(
      provider({ prepare: () => Promise.resolve({ canRequestAds: false }), showAppOpenAd: show }),
    );

    const result = await maybeShowAppOpenAd({ onboarding: false }, NOW);

    expect(result.reason).toBe('no-consent');
    expect(show).not.toHaveBeenCalled();
  });

  it('条件がそろえば出して、状態を書く', async () => {
    mockMeta.set(
      'app_open_ad_state',
      JSON.stringify({ firstLaunchAt: LONG_AGO, lastShownAt: null, shownToday: 0 }),
    );
    resetAppOpenAdProviderForTesting(provider());

    const result = await maybeShowAppOpenAd({ onboarding: false }, NOW);

    expect(result).toEqual({ shown: true, reason: 'ok' });
    const state = await readAppOpenAdState();
    expect(state.lastShownAt).toBe(NOW.toISOString());
    expect(state.shownToday).toBe(1);
  });

  // 出せなかったのに数えると、次の起動でも出なくなって二重に損をする
  it('表示に失敗したら状態を書かない', async () => {
    mockMeta.set(
      'app_open_ad_state',
      JSON.stringify({ firstLaunchAt: LONG_AGO, lastShownAt: null, shownToday: 0 }),
    );
    resetAppOpenAdProviderForTesting(provider({ showAppOpenAd: () => Promise.resolve(false) }));

    const result = await maybeShowAppOpenAd({ onboarding: false }, NOW);

    expect(result).toEqual({ shown: false, reason: 'load-failed' });
    expect((await readAppOpenAdState()).lastShownAt).toBeNull();
  });

  // 起動広告のために起動が止まるのが最悪の失敗
  it('provider が投げても起動を止めない', async () => {
    mockMeta.set(
      'app_open_ad_state',
      JSON.stringify({ firstLaunchAt: LONG_AGO, lastShownAt: null, shownToday: 0 }),
    );
    resetAppOpenAdProviderForTesting(
      provider({
        prepare: () => Promise.reject(new Error('boom')),
      }),
    );

    await expect(maybeShowAppOpenAd({ onboarding: false }, NOW)).resolves.toEqual({
      shown: false,
      reason: 'load-failed',
    });
  });

  it('壊れた状態が入っていても落ちない', async () => {
    mockMeta.set('app_open_ad_state', 'これは JSON ではない');
    resetAppOpenAdProviderForTesting(provider());

    await expect(maybeShowAppOpenAd({ onboarding: false }, NOW)).resolves.toBeDefined();
  });
});
