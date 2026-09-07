/**
 * 収穫カードのプレビュー（R28 / WBS 4.10 / #41）
 *
 * **共有シートへ渡す前に「何が外へ出るか」を見せる**ための表示。
 * 共有は取り消せない操作なので、押す前に写真とことばを目で確かめられること自体が
 * 機能の一部になっている。
 *
 * カードの絵そのものを画像として書き出す手段は今のところ無い
 * （理由は `harvest-share.service.ts` 冒頭）。ここはアプリの中だけの見た目で、
 * 外へ出るのは写真とことば。**将来ここを画像化できるようになったときに
 * そのまま素材になる**ように、日付・数量・アプリ名まで載せた完成形で描いてある。
 */
import { ShoppingBasket } from 'lucide-react-native';
import { Image, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import {
  formatCropTitle,
  formatHarvestAmount,
  formatHarvestDate,
  type HarvestShareCard,
} from '../services/harvest-share.service';

interface HarvestShareCardViewProps {
  card: HarvestShareCard;
  /** ファイルが消えていて写真を描けなかった。画面側は共有からも外す */
  onPhotoError?: () => void;
  /** 写真を出さない（読み込みに失敗した後の再描画） */
  photoHidden?: boolean;
}

export function HarvestShareCardView({
  card,
  onPhotoError,
  photoHidden,
}: HarvestShareCardViewProps) {
  const amount = formatHarvestAmount(card.quantity, card.unit);
  const showPhoto = card.photoUri != null && !photoHidden;

  return (
    <View style={styles.card} testID="harvest-share-card">
      {showPhoto ? (
        <Image
          source={{ uri: card.photoUri as string }}
          style={styles.photo}
          resizeMode="cover"
          onError={onPhotoError}
          accessibilityLabel={`${card.cropName}の収穫写真`}
        />
      ) : (
        <View style={[styles.photo, styles.photoPlaceholder]}>
          <ShoppingBasket size={28} color={Colors.inkDim} />
          <Text style={styles.placeholderText}>写真のない収穫です</Text>
        </View>
      )}

      <View style={styles.body}>
        <Text style={styles.crop}>{formatCropTitle(card)}</Text>
        {amount ? (
          <Text style={styles.amount}>{amount}</Text>
        ) : (
          // 数量は任意入力（R06）。無いときに空欄を残すとカードが崩れて見える
          <Text style={styles.amountEmpty}>収穫</Text>
        )}
        <Text style={styles.date}>{formatHarvestDate(card.harvestedAt)}</Text>

        <View style={styles.brand}>
          <Image
            source={require('../../assets/icon.png')}
            style={styles.brandMark}
            accessibilityIgnoresInvertColors
          />
          <Text style={styles.brandName}>さいえん手帳</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    aspectRatio: 4 / 3,
    backgroundColor: Colors.surfaceInput,
  },
  photoPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  placeholderText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  body: { padding: 16, gap: 4 },
  crop: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  amount: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    color: Colors.harvest,
  },
  amountEmpty: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.harvest,
  },
  date: { fontSize: Typography.size.sm, color: Colors.inkDim },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.line,
  },
  brandMark: { width: 18, height: 18, borderRadius: 4 },
  brandName: { fontSize: Typography.size.xs, color: Colors.inkDim },
});
