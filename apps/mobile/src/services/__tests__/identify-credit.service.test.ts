/**
 * 写真からの栽培登録の通行権（#139）。
 *
 * 守りたいのは 2 つ:
 * 1. **相談・収穫の無料枠を一切消費しない**（混ぜると初回登録で相談が消える）
 * 2. **視聴済みの回数が翌日に消えない**（AdMob の「開示した報酬を届ける」）
 */
const mockStore = new Map<string, string>();

jest.mock('../app-meta.service', () => ({
  getAppMeta: (key: string) => Promise.resolve(mockStore.get(key) ?? null),
  setAppMeta: (key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  },
}));

import {
  consumeIdentifyCredit,
  getIdentifyCredits,
  grantIdentifyCredits,
  IDENTIFY_CREDIT_CAP,
  IDENTIFY_PER_REWARD,
  resetIdentifyCredits,
} from '../identify-credit.service';

beforeEach(() => mockStore.clear());

describe('identify-credit.service', () => {
  it('初期状態は 0（無料では 1 枚も読み取れない）', async () => {
    expect(await getIdentifyCredits()).toBe(0);
  });

  it('リワード 1 本で IDENTIFY_PER_REWARD 枚ぶん増える', async () => {
    expect(await grantIdentifyCredits()).toBe(IDENTIFY_PER_REWARD);
    expect(await getIdentifyCredits()).toBe(IDENTIFY_PER_REWARD);
  });

  it('消費すると 1 枚ずつ減る', async () => {
    await grantIdentifyCredits();
    expect(await consumeIdentifyCredit()).toBe(true);
    expect(await getIdentifyCredits()).toBe(IDENTIFY_PER_REWARD - 1);
  });

  it('残高が無ければ消費できず、何も減らさない', async () => {
    expect(await consumeIdentifyCredit()).toBe(false);
    expect(await getIdentifyCredits()).toBe(0);
  });

  // 上限が無いと、動画だけ連続で見て残高を積み上げ、
  // 後からまとめて叩いてサーバーのプールを一度に食える。
  it('貯め込みは上限で頭打ちになる', async () => {
    for (let i = 0; i < 20; i++) await grantIdentifyCredits();
    expect(await getIdentifyCredits()).toBe(IDENTIFY_CREDIT_CAP);
  });

  // 日付キーにすると、視聴後にアプリを閉じただけで約束した回数が消える。
  it('残高キーに日付を含めない（翌日も残る）', async () => {
    await grantIdentifyCredits();
    const keys = [...mockStore.keys()];
    expect(keys).toEqual(['planting_identify_credits']);
    expect(keys[0]).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  // 相談・収穫の枠（usage.service）と混ざっていないことを、キー名で固定する。
  it('相談・収穫の枠のキーを触らない', async () => {
    await grantIdentifyCredits();
    await consumeIdentifyCredit();
    const keys = [...mockStore.keys()];
    expect(keys.some((key) => key.startsWith('ai_photo_recipe_'))).toBe(false);
  });

  it('壊れた値は 0 として扱う', async () => {
    mockStore.set('planting_identify_credits', 'あ');
    expect(await getIdentifyCredits()).toBe(0);
  });

  it('負の値は 0 として扱う', async () => {
    mockStore.set('planting_identify_credits', '-5');
    expect(await getIdentifyCredits()).toBe(0);
  });

  it('リセットで 0 に戻る', async () => {
    await grantIdentifyCredits();
    await resetIdentifyCredits();
    expect(await getIdentifyCredits()).toBe(0);
  });
});
