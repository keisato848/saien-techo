/**
 * 起動広告の頻度判定（§8.2 / WBS 3.7）。
 *
 * 出しすぎは実機で数日回さないと体感できず、出なさすぎは気づけない。
 * 境界をここで固定する。
 */
import {
  APP_OPEN_GRACE_HOURS,
  APP_OPEN_MAX_PER_DAY,
  APP_OPEN_MIN_INTERVAL_MINUTES,
  type AppOpenAdContext,
  type AppOpenAdState,
  decideAppOpenAd,
  recordAppOpenAdShown,
} from '../appOpenAdFrequency';

/** 端末ローカルの日時（月は 1 始まりで受ける） */
function at(y: number, m: number, d: number, h = 0, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

const INSTALLED_LONG_AGO = at(2026, 8, 1, 9).toISOString();

function context(overrides: Partial<AppOpenAdContext> = {}): AppOpenAdContext {
  const state: AppOpenAdState = {
    firstLaunchAt: INSTALLED_LONG_AGO,
    lastShownAt: null,
    shownToday: 0,
    ...(overrides.state ?? {}),
  };
  return {
    enabled: true,
    canRequestAds: true,
    onboarding: false,
    ...overrides,
    state,
  };
}

describe('decideAppOpenAd', () => {
  const NOW = at(2026, 8, 10, 12);

  it('条件がそろえば出す', () => {
    expect(decideAppOpenAd(context(), NOW)).toEqual({ show: true, reason: 'ok' });
  });

  it('フラグが無効なら出さない', () => {
    expect(decideAppOpenAd(context({ enabled: false }), NOW).reason).toBe('disabled');
  });

  it('同意が取れていなければ出さない', () => {
    expect(decideAppOpenAd(context({ canRequestAds: false }), NOW).reason).toBe('no-consent');
  });

  it('オンボーディング中は出さない（最初の体験を邪魔しない）', () => {
    expect(decideAppOpenAd(context({ onboarding: true }), NOW).reason).toBe('onboarding');
  });

  describe('入れた直後', () => {
    it('猶予時間の内は出さない', () => {
      const justInstalled = at(2026, 8, 10, 6).toISOString();
      const decision = decideAppOpenAd(
        context({ state: { firstLaunchAt: justInstalled, lastShownAt: null, shownToday: 0 } }),
        NOW,
      );
      expect(decision.reason).toBe('within-grace');
    });

    it('猶予を過ぎたら出す', () => {
      const first = new Date(NOW.getTime() - (APP_OPEN_GRACE_HOURS + 1) * 3_600_000).toISOString();
      const decision = decideAppOpenAd(
        context({ state: { firstLaunchAt: first, lastShownAt: null, shownToday: 0 } }),
        NOW,
      );
      expect(decision.show).toBe(true);
    });

    it('初回起動時刻が未記録でも落ちない', () => {
      const decision = decideAppOpenAd(
        context({ state: { firstLaunchAt: null, lastShownAt: null, shownToday: 0 } }),
        NOW,
      );
      expect(decision.show).toBe(true);
    });
  });

  describe('間隔', () => {
    it('前回から間が空いていなければ出さない', () => {
      const last = new Date(NOW.getTime() - 5 * 60_000).toISOString();
      expect(
        decideAppOpenAd(
          context({
            state: { firstLaunchAt: INSTALLED_LONG_AGO, lastShownAt: last, shownToday: 1 },
          }),
          NOW,
        ).reason,
      ).toBe('too-soon');
    });

    it('間隔ちょうどで出す', () => {
      const last = new Date(NOW.getTime() - APP_OPEN_MIN_INTERVAL_MINUTES * 60_000).toISOString();
      expect(
        decideAppOpenAd(
          context({
            state: { firstLaunchAt: INSTALLED_LONG_AGO, lastShownAt: last, shownToday: 1 },
          }),
          NOW,
        ).show,
      ).toBe(true);
    });
  });

  describe('1 日の上限', () => {
    it('上限に達していたら出さない', () => {
      const last = at(2026, 8, 10, 8).toISOString();
      expect(
        decideAppOpenAd(
          context({
            state: {
              firstLaunchAt: INSTALLED_LONG_AGO,
              lastShownAt: last,
              shownToday: APP_OPEN_MAX_PER_DAY,
            },
          }),
          NOW,
        ).reason,
      ).toBe('daily-cap');
    });

    // 日をまたいだら数え直す。またがないと「昨日3回出た」で今日ずっと出ない
    it('日が変わればまた出す', () => {
      const last = at(2026, 8, 9, 22).toISOString();
      expect(
        decideAppOpenAd(
          context({
            state: {
              firstLaunchAt: INSTALLED_LONG_AGO,
              lastShownAt: last,
              shownToday: APP_OPEN_MAX_PER_DAY,
            },
          }),
          NOW,
        ).show,
      ).toBe(true);
    });
  });

  it('壊れた日時でも落ちない', () => {
    const decision = decideAppOpenAd(
      context({
        state: { firstLaunchAt: 'こわれた', lastShownAt: 'こわれた', shownToday: 0 },
      }),
      NOW,
    );
    expect(decision.show).toBe(true);
  });
});

describe('recordAppOpenAdShown', () => {
  const NOW = at(2026, 8, 10, 12);

  it('同じ日なら数を足す', () => {
    const next = recordAppOpenAdShown(
      {
        firstLaunchAt: INSTALLED_LONG_AGO,
        lastShownAt: at(2026, 8, 10, 8).toISOString(),
        shownToday: 2,
      },
      NOW,
    );
    expect(next.shownToday).toBe(3);
    expect(next.lastShownAt).toBe(NOW.toISOString());
  });

  it('日が変わったら 1 に戻す', () => {
    const next = recordAppOpenAdShown(
      {
        firstLaunchAt: INSTALLED_LONG_AGO,
        lastShownAt: at(2026, 8, 9, 22).toISOString(),
        shownToday: 3,
      },
      NOW,
    );
    expect(next.shownToday).toBe(1);
  });

  it('初回は 1', () => {
    const next = recordAppOpenAdShown(
      { firstLaunchAt: INSTALLED_LONG_AGO, lastShownAt: null, shownToday: 0 },
      NOW,
    );
    expect(next.shownToday).toBe(1);
  });

  it('初回起動時刻は保つ', () => {
    const next = recordAppOpenAdShown(
      { firstLaunchAt: INSTALLED_LONG_AGO, lastShownAt: null, shownToday: 0 },
      NOW,
    );
    expect(next.firstLaunchAt).toBe(INSTALLED_LONG_AGO);
  });
});
