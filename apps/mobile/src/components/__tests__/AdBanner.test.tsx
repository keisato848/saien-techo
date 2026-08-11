/**
 * AdBanner — 「出さない条件」を検証する（§8.2 / WBS 3.7）。
 *
 * 見るのは 3 分岐: 広告無効ビルド / 同意未解決 / 同意済み。
 * BannerAd 自体は手動モック（null 描画）なので、外側の View の有無で判定する。
 */
import { render, waitFor } from '@testing-library/react-native';
import { AdsConsent } from 'react-native-google-mobile-ads';

let mockAdmobEnabled = false;
jest.mock('../../config', () => ({
  get ADMOB_ENABLED() {
    return mockAdmobEnabled;
  },
  ADMOB_BANNER_UNIT_ID: '',
}));

import { AdBanner } from '../AdBanner';

const mockGetConsentInfo = AdsConsent.getConsentInfo as jest.Mock;

beforeEach(() => {
  mockAdmobEnabled = false;
  mockGetConsentInfo.mockReset().mockResolvedValue({ canRequestAds: true });
});

describe('AdBanner', () => {
  it('広告無効ビルド（既定）では何も描画せず、同意状態も見ない', () => {
    const { toJSON } = render(<AdBanner />);
    expect(toJSON()).toBeNull();
    expect(mockGetConsentInfo).not.toHaveBeenCalled();
  });

  it('同意済みなら描画する', async () => {
    mockAdmobEnabled = true;
    const { toJSON } = render(<AdBanner />);
    await waitFor(() => expect(toJSON()).not.toBeNull());
  });

  it('同意が未解決（canRequestAds=false）なら出さない', async () => {
    mockAdmobEnabled = true;
    mockGetConsentInfo.mockResolvedValue({ canRequestAds: false });
    const { toJSON } = render(<AdBanner />);
    await waitFor(() => expect(mockGetConsentInfo).toHaveBeenCalled());
    expect(toJSON()).toBeNull();
  });
});
