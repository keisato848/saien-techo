/**
 * Web には AdMob が無い。この兄弟ファイルで react-native-google-mobile-ads を
 * web バンドルから外す（Metro が web ではこちらを解決する）。
 */
import type { AppOpenAdProvider } from './app-open-ad.types';

export class AdMobAppOpenAdProvider implements AppOpenAdProvider {
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
    // no-op — web に広告が無いので同意 UI も無い
  }
}
