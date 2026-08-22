/**
 * 無料枠とリワード広告の通行権。
 *
 * **無料枠はインストールごとに 1 回**（日次ではない — 2026-08-21 決定）。
 * ここで一番大事なのは「**生涯枠とその日のボーナスを混ぜない**」こと。
 * 引き算 1 本にまとめると、生涯で増え続ける消費数がボーナスを食い潰し、
 * **広告を見ても解放されない**。その回帰をテストで固定する。
 */
let mockStore: Record<string, string> = {};
let mockPremium = false;
let mockAdAvailable = false;
let mockByok = false;

jest.mock('../app-meta.service', () => ({
  getAppMeta: jest.fn(async (key: string) => mockStore[key] ?? null),
  setAppMeta: jest.fn(async (key: string, value: string) => {
    mockStore[key] = value;
  }),
}));

jest.mock('../entitlement.service', () => ({
  isPremium: jest.fn(async () => mockPremium),
}));

jest.mock('../ad-reward.service', () => ({
  isAdRewardAvailable: jest.fn(() => mockAdAvailable),
}));

jest.mock('../byok.service', () => ({
  hasUserApiKey: jest.fn(async () => mockByok),
}));

import {
  AD_BONUS_DAILY_LIMIT,
  currentDayKey,
  deriveFreemiumStatus,
  FREE_LIFETIME_LIMIT,
  getAdBonusGranted,
  getAdBonusUsed,
  getFreeUsage,
  getFreemiumStatus,
  grantAdBonus,
  incrementUsage,
  recordCloudInference,
  remainingFree,
} from '../usage.service';

describe('usage.service', () => {
  beforeEach(() => {
    mockStore = {};
    mockPremium = false;
    mockAdAvailable = false;
    mockByok = false;
  });

  describe('currentDayKey', () => {
    it('formats year-month-day, zero-padded', () => {
      // Local-time constructors (the function uses the user's calendar day).
      expect(currentDayKey(new Date(2026, 5, 28))).toBe('2026-06-28');
      expect(currentDayKey(new Date(2026, 0, 1))).toBe('2026-01-01');
      expect(currentDayKey(new Date(2026, 11, 9))).toBe('2026-12-09');
    });
  });

  describe('remainingFree', () => {
    it('never goes negative', () => {
      expect(remainingFree(0)).toBe(1);
      expect(remainingFree(1)).toBe(0);
      expect(remainingFree(3)).toBe(0);
    });
  });

  describe('deriveFreemiumStatus', () => {
    it('grants unlimited use to premium', () => {
      const status = deriveFreemiumStatus(true, 99);
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
      expect(status.remaining).toBe(Number.POSITIVE_INFINITY);
    });

    it('gates the free tier by the lifetime limit', () => {
      expect(deriveFreemiumStatus(false, 0)).toMatchObject({
        remaining: 1,
        canInfer: true,
        hasFreeLeft: true,
      });
      expect(deriveFreemiumStatus(false, 1)).toMatchObject({
        remaining: 0,
        canInfer: false,
        hasFreeLeft: false,
      });
      expect(deriveFreemiumStatus(false, 2)).toMatchObject({ remaining: 0, canInfer: false });
    });

    it('supports a zero free limit (ads become the only path)', () => {
      // EXPO_PUBLIC_FREE_LIFETIME_LIMIT=0 のビルド（広告フロー検証にも使う）
      const status = deriveFreemiumStatus(false, 0, 0, 0, true, false, 0);
      expect(status).toMatchObject({ remaining: 0, canInfer: false, canWatchAdForMore: true });
      const afterBonus = deriveFreemiumStatus(false, 0, 1, 0, true, false, 0);
      expect(afterBonus).toMatchObject({ remaining: 1, canInfer: true });
    });

    /**
     * 生涯枠とその日のボーナスを 1 本の引き算にすると壊れる箇所。
     * 無料 1 回を使い切ったあと、翌日にボーナスが 0 へ戻っても
     * **広告 1 本で 1 回使えること**を固定する。
     */
    it('ad bonus works after the lifetime free is spent (no carry-over starvation)', () => {
      // 無料 1 回消費済み・その日の広告 1 本ぶんは未消費
      expect(deriveFreemiumStatus(false, 1, 1, 0, true)).toMatchObject({
        remaining: 1,
        canInfer: true,
      });
      // そのボーナスも使ったら 0 に戻る
      expect(deriveFreemiumStatus(false, 1, 1, 1, true)).toMatchObject({
        remaining: 0,
        canInfer: false,
      });
      // 前日に上限まで使っていても、翌日（granted=0 に戻る）は広告を勧められる
      expect(deriveFreemiumStatus(false, 1, 0, 0, true).canWatchAdForMore).toBe(true);
    });
  });

  describe('無料ぶん（生涯）の数え方', () => {
    it('日付が変わっても戻らない', async () => {
      const day1 = new Date(2026, 5, 30);
      const day2 = new Date(2026, 6, 1);
      expect(await getFreeUsage()).toBe(0);
      await incrementUsage(day1);
      expect(await getFreeUsage()).toBe(1);
      // **ここが変更点** — 以前は翌日に 0 へ戻っていた
      expect(await getFreeUsage()).toBe(1);
      expect((await getFreemiumStatus()).canInfer).toBe(false);
      await incrementUsage(day2);
      expect(await getFreeUsage()).toBe(1); // 枠が無いので増えない
    });

    it('無料ぶんを使い切ったらボーナスから引かれる', async () => {
      const d = new Date(2026, 5, 10);
      await incrementUsage(d); // 無料 1 回目
      await grantAdBonus(d);
      await incrementUsage(d); // ボーナスから
      expect(await getFreeUsage()).toBe(1);
      expect(await getAdBonusUsed(d)).toBe(1);
    });

    it('ボーナスが無ければ何も増やさない（呼び出し側の gate 漏れを吸収）', async () => {
      const d = new Date(2026, 5, 10);
      await incrementUsage(d); // 無料を消費
      await incrementUsage(d); // 枠なし
      expect(await getFreeUsage()).toBe(1);
      expect(await getAdBonusUsed(d)).toBe(0);
    });
  });

  describe('getFreemiumStatus', () => {
    it('reflects the device-local count for free users', async () => {
      const status = await getFreemiumStatus();
      expect(status).toMatchObject({ isPremium: false, used: 0, remaining: FREE_LIFETIME_LIMIT });
    });

    it('reports unlimited for premium users', async () => {
      mockPremium = true;
      const status = await getFreemiumStatus();
      expect(status.isPremium).toBe(true);
      expect(status.canInfer).toBe(true);
    });

    it('reports unlimited (BYOK) when a user key is set', async () => {
      mockByok = true;
      const status = await getFreemiumStatus();
      expect(status.isByok).toBe(true);
      expect(status.canInfer).toBe(true);
    });
  });

  describe('recordCloudInference', () => {
    it('counts a use for free users', async () => {
      await recordCloudInference();
      expect(await getFreeUsage()).toBe(1);
    });

    it('does not count for premium users', async () => {
      mockPremium = true;
      await recordCloudInference();
      expect(await getFreeUsage()).toBe(0);
    });

    it('does not count for BYOK users', async () => {
      mockByok = true;
      await recordCloudInference();
      expect(await getFreeUsage()).toBe(0);
    });
  });

  describe('ad bonus', () => {
    it('grants extra uses up to the daily cap', async () => {
      const d = new Date(2026, 5, 10);
      expect(await getAdBonusGranted(d)).toBe(0);
      expect(await grantAdBonus(d)).toBe(1);
      expect(await grantAdBonus(d)).toBe(2);
      expect(await grantAdBonus(d)).toBe(AD_BONUS_DAILY_LIMIT);
      // further grants are capped
      expect(await grantAdBonus(d)).toBe(AD_BONUS_DAILY_LIMIT);
    });

    it('獲得ぶんは翌日に戻る（ボーナスは日次のまま）', async () => {
      const day1 = new Date(2026, 5, 30);
      const day2 = new Date(2026, 6, 1);
      await grantAdBonus(day1);
      expect(await getAdBonusGranted(day1)).toBe(1);
      expect(await getAdBonusGranted(day2)).toBe(0);
    });

    it('offers an ad only when out of uses, ads available, cap not reached', () => {
      expect(deriveFreemiumStatus(false, 1, 0, 0, true).canWatchAdForMore).toBe(true);
      // ads unavailable → no offer
      expect(deriveFreemiumStatus(false, 1, 0, 0, false).canWatchAdForMore).toBe(false);
      // still has a use left → no offer yet
      expect(deriveFreemiumStatus(false, 0, 0, 0, true).canWatchAdForMore).toBe(false);
      // bonus cap reached（獲得も消費も上限）→ no offer
      expect(
        deriveFreemiumStatus(false, 1, AD_BONUS_DAILY_LIMIT, AD_BONUS_DAILY_LIMIT, true)
          .canWatchAdForMore,
      ).toBe(false);
    });

    it('never offers ads to premium users', () => {
      expect(deriveFreemiumStatus(true, 0, 0, 0, true).canWatchAdForMore).toBe(false);
    });

    it('treats BYOK as unlimited (no ads, no quota)', () => {
      const status = deriveFreemiumStatus(false, 5, 0, 0, true, true);
      expect(status).toMatchObject({
        isByok: true,
        isPremium: false,
        canInfer: true,
        canWatchAdForMore: false,
        remaining: Number.POSITIVE_INFINITY,
      });
    });

    it('getFreemiumStatus surfaces the ad option when available and exhausted', async () => {
      mockAdAvailable = true;
      await recordCloudInference(); // 無料の 1 回を使う
      const status = await getFreemiumStatus();
      expect(status.canInfer).toBe(false);
      expect(status.canWatchAdForMore).toBe(true);
    });
  });
});
