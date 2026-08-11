/**
 * アンカー型アダプティブバナー（§8.2 / WBS 3.7）
 *
 * **置くのは作物ガイド（閲覧型画面）だけ。** 記録導線（1〜2 タップの価値）に
 * 広告を挟まない方針なので、ホーム・栽培詳細・各フォームには置かないこと。
 *
 * 出さない条件をこのコンポーネントに閉じ込める:
 * - ADMOB_ENABLED でないビルド（既定）→ null。画面側は無条件に置いてよい
 * - UMP の同意が未解決（canRequestAds でない）→ null
 * - 読み込み失敗 → null（空白の帯を残さない — 枠を先に確保しない理由）
 *
 * web 版は AdBanner.web.tsx（常に null）。SDK を web バンドルに入れない。
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { AdsConsent, BannerAd, BannerAdSize, TestIds } from 'react-native-google-mobile-ads';

import { ADMOB_BANNER_UNIT_ID, ADMOB_ENABLED } from '../config';

const UNIT_ID = ADMOB_BANNER_UNIT_ID || TestIds.BANNER;

export function AdBanner() {
  const [canRequestAds, setCanRequestAds] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!ADMOB_ENABLED) return;
    let cancelled = false;
    // 同意フローは起動広告（app-open-ad.service）が解決済み。ここは結果を見るだけ
    AdsConsent.getConsentInfo()
      .then((info) => {
        if (!cancelled) setCanRequestAds(info.canRequestAds);
      })
      .catch(() => {
        // 同意状態が読めないなら出さない（安全側）
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ADMOB_ENABLED || !canRequestAds || failed) return null;

  return (
    <View>
      <BannerAd
        unitId={UNIT_ID}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        onAdFailedToLoad={() => setFailed(true)}
      />
    </View>
  );
}
