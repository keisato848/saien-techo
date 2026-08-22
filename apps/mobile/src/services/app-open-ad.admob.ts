/**
 * 起動広告（AdMob）— §8.2 / WBS 3.7
 *
 * ad-reward.admob.ts と並ぶ、react-native-google-mobile-ads を import する
 * もう一つのモジュール。web バンドルに SDK を持ち込まないよう .web 兄弟を置く。
 * 実 ID を入れるまでは公式テスト ID（TestIds.APP_OPEN）で動く。
 *
 * ## 同意管理（UMP）
 *
 * gatherConsent() は**地域を SDK 側が判定する**。EEA/UK では同意フォームが出て、
 * 日本など対象外では出ない。だから「日本の利用者にだけ出さない」条件分岐を
 * こちらで書く必要はない。パーソナライズの可否も SDK が同意状態に従うので、
 * requestNonPersonalizedAdsOnly は固定しない。
 *
 * ## 例外を投げない理由
 *
 * 起動広告は**出なくてもアプリは使える**もの。読み込み失敗や同意未取得で
 * 起動が止まると本末転倒なので、この層で握って false を返す。
 */
import mobileAds, {
  AdEventType,
  AdsConsent,
  AdsConsentPrivacyOptionsRequirementStatus,
  AppOpenAd,
  TestIds,
} from 'react-native-google-mobile-ads';

import { ADMOB_ALLOW_TEST_UNITS, ADMOB_APP_OPEN_UNIT_ID } from '../config';
import type { AppOpenAdProvider } from './app-open-ad.types';

// **空のまま TestIds へ落とさない**（config.ts の ADMOB_ALLOW_TEST_UNITS 参照）。
// 落とすと本番ビルドにテスト広告が出る。空なら起動広告は出さない
const UNIT_ID = ADMOB_APP_OPEN_UNIT_ID || (ADMOB_ALLOW_TEST_UNITS ? TestIds.APP_OPEN : '');

/** 読み込みがこれ以上かかるなら諦める。起動を待たせない */
const LOAD_TIMEOUT_MS = 8_000;

export class AdMobAppOpenAdProvider implements AppOpenAdProvider {
  private initialized = false;

  async prepare(): Promise<{ canRequestAds: boolean }> {
    try {
      // requestInfoUpdate ＋ 必要な地域でだけフォーム表示
      await AdsConsent.gatherConsent();
    } catch {
      // 通信不通などで更新できなくても、前回の同意状態で出せるかを下で見る
    }

    try {
      const info = await AdsConsent.getConsentInfo();
      if (!info.canRequestAds) return { canRequestAds: false };
      if (!this.initialized) {
        await mobileAds().initialize();
        this.initialized = true;
      }
      return { canRequestAds: true };
    } catch {
      return { canRequestAds: false };
    }
  }

  async isPrivacyOptionsRequired(): Promise<boolean> {
    try {
      const info = await AdsConsent.getConsentInfo();
      return (
        info.privacyOptionsRequirementStatus === AdsConsentPrivacyOptionsRequirementStatus.REQUIRED
      );
    } catch {
      return false;
    }
  }

  async showPrivacyOptionsForm(): Promise<void> {
    await AdsConsent.showPrivacyOptionsForm();
  }

  async showAppOpenAd(): Promise<boolean> {
    // ユニット未設定なら出さない。起動広告は出なくてもアプリは使える
    if (UNIT_ID === '') return false;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const cleanups: Array<() => void> = [];
      const finish = (shown: boolean): void => {
        if (settled) return;
        settled = true;
        cleanups.forEach((off) => off());
        clearTimeout(timer);
        resolve(shown);
      };

      const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS);

      try {
        const ad = AppOpenAd.createForAdRequest(UNIT_ID);

        cleanups.push(
          ad.addAdEventListener(AdEventType.LOADED, () => {
            ad.show().catch(() => finish(false));
          }),
        );
        // 閉じられて初めて「出せた」とみなす（表示前に落ちることがある）
        cleanups.push(ad.addAdEventListener(AdEventType.CLOSED, () => finish(true)));
        cleanups.push(ad.addAdEventListener(AdEventType.ERROR, () => finish(false)));

        ad.load();
      } catch {
        finish(false);
      }
    });
  }
}
