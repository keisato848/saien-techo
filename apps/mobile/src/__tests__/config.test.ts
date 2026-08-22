/**
 * 広告ユニット ID の解決（iOS 対応・2026-08-13）。
 *
 * **AdMob のユニットはプラットフォームごとに別物**なので、iOS で Android の
 * ユニット ID を使っても配信されない。無印 = Android・`_IOS` 付き = iOS として
 * 持ち、実行中のプラットフォームのものへ解決する。
 *
 * あわせて「未設定なら空文字」を固定する。**空を公式テスト ID へ落とすと、
 * 本番ビルドにテスト広告が出る** — iOS のユニットを作る前に iOS ビルドを回すと
 * 実際にこの状態になる。テスト広告の本番配信は AdMob のポリシー違反にあたるため、
 * 各広告フォーマット側は「空なら出さない」を既定にしている。
 */
import { Platform } from 'react-native';

import { platformAdUnit } from '../config';

const ANDROID_ID = 'ca-app-pub-1111111111111111/1111111111';
const IOS_ID = 'ca-app-pub-2222222222222222/2222222222';

describe('platformAdUnit', () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  function setPlatform(os: 'ios' | 'android'): void {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }

  it('Android では無印のユニットを使う', () => {
    setPlatform('android');
    expect(platformAdUnit(ANDROID_ID, IOS_ID)).toBe(ANDROID_ID);
  });

  it('iOS では _IOS 付きのユニットを使う', () => {
    setPlatform('ios');
    expect(platformAdUnit(ANDROID_ID, IOS_ID)).toBe(IOS_ID);
  });

  // iOS のユニットを作る前に iOS ビルドを回すとこの状態になる。
  // ここで Android のユニットに落とすと、iOS で配信されない ID を使い続ける
  it('iOS 用が未設定でも Android のユニットへは落とさない', () => {
    setPlatform('ios');
    expect(platformAdUnit(ANDROID_ID, undefined)).toBe('');
  });

  it('Android 用が未設定でも iOS のユニットへは落とさない', () => {
    setPlatform('android');
    expect(platformAdUnit(undefined, IOS_ID)).toBe('');
  });

  it('どちらも未設定なら空文字（呼び出し側が「出さない」を選べる）', () => {
    setPlatform('android');
    expect(platformAdUnit(undefined, undefined)).toBe('');
  });
});
