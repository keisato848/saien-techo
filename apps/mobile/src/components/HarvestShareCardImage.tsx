/**
 * 収穫カード（R28 / WBS 4.10 / #41）
 *
 * **これは「プレビュー」であると同時に「書き出す素材そのもの」**。
 * 画面に見えているこの SVG を `toDataURL` でそのままビットマップにして共有する
 * （理由は `harvest-share.service.ts` 冒頭）。だから
 *
 * - **見えているものと出ていくものが必ず一致する。** 共有は取り消せない操作なので、
 *   押す前に何が出るか目で確かめられること自体が機能の一部
 * - **画面に描かれることで写真が Fresco のキャッシュに載る。** Android の RNSVG は
 *   キャッシュにある写真しか描かないので、プレビューを経由しない書き出しは
 *   写真の抜けたカードになる
 *
 * ## SVG で描くうえでの制約
 *
 * `<Text>` は**折り返しも省略もしない**（はみ出した分はそのまま外へ描かれる）。
 * 見出しは `truncateForCard` で畳んでから渡す。行の高さも自前で決め打つ。
 */
import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Image as SvgImage, Line, Rect, Text as SvgText } from 'react-native-svg';

import { Colors } from '../constants/theme';
import {
  formatCropTitle,
  formatHarvestAmount,
  formatHarvestDate,
  truncateForCard,
  type HarvestShareCard,
} from '../services/harvest-share.service';

/** カードの内部座標。書き出しの解像度は画面上の実寸（px）で決まる */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1440;
/** 写真は正方形に切る（送り先のサムネイルで欠けにくい） */
const PHOTO_HEIGHT = 1080;
const PADDING = 64;

interface HarvestShareCardImageProps {
  card: HarvestShareCard;
  /** 焼き込む写真。位置情報を落とした後の uri を渡す。null ならことばだけのカード */
  photoUri: string | null;
  /** 写真が Fresco に載った合図。画面はこれが来るまで共有を押させない */
  onPhotoLoad?: () => void;
  /** 画面上の幅（dp）。書き出す画像の画素数はこの実寸で決まる */
  width: number;
}

/**
 * 収穫カード。ref は `Svg` に付く（`toDataURL` を呼ぶため）。
 */
export const HarvestShareCardImage = forwardRef<Svg, HarvestShareCardImageProps>(
  function HarvestShareCardImage({ card, photoUri, onPhotoLoad, width }, ref) {
    const amount = formatHarvestAmount(card.quantity, card.unit);
    const title = truncateForCard(formatCropTitle(card));
    const date = formatHarvestDate(card.harvestedAt);
    const height = (width * CARD_HEIGHT) / CARD_WIDTH;

    return (
      <View style={[styles.frame, { width, height }]} testID="harvest-share-card">
        <Svg ref={ref} width={width} height={height} viewBox={`0 0 ${CARD_WIDTH} ${CARD_HEIGHT}`}>
          {/* 下地。書き出した PNG は透過を持つので、必ず塗りつぶしてから重ねる */}
          <Rect x={0} y={0} width={CARD_WIDTH} height={CARD_HEIGHT} fill={Colors.surface} />

          {photoUri ? (
            <SvgImage
              testID="harvest-share-photo"
              href={{ uri: photoUri }}
              x={0}
              y={0}
              width={CARD_WIDTH}
              height={PHOTO_HEIGHT}
              preserveAspectRatio="xMidYMid slice"
              onLoad={onPhotoLoad}
            />
          ) : (
            <>
              {/* 写真のない収穫（数量だけ／写真が読めなかった）。
                  枠を空けたままにすると「壊れたカード」に見えるので、
                  採れた量を主役にした 1 枚にする */}
              <Rect
                x={0}
                y={0}
                width={CARD_WIDTH}
                height={PHOTO_HEIGHT}
                fill={Colors.accentSoft}
                testID="harvest-share-photoless"
              />
              <SvgText
                testID="harvest-share-hero"
                x={CARD_WIDTH / 2}
                y={PHOTO_HEIGHT / 2 + 48}
                textAnchor="middle"
                fontSize={amount ? 150 : 90}
                fontWeight="600"
                fill={Colors.harvest}
              >
                {amount ?? '収穫'}
              </SvgText>
            </>
          )}

          {/* 帯。作物名・数量・日付・アプリ名はここに焼き込む —
              Android は写真とことばを一緒に運べないので、ことばは画像の中にしか置けない */}
          <SvgText
            testID="harvest-share-title"
            x={PADDING}
            y={PHOTO_HEIGHT + 108}
            fontSize={64}
            fontWeight="600"
            fill={Colors.ink}
          >
            {title}
          </SvgText>
          {amount ? (
            <SvgText
              testID="harvest-share-amount"
              x={CARD_WIDTH - PADDING}
              y={PHOTO_HEIGHT + 108}
              textAnchor="end"
              fontSize={64}
              fontWeight="600"
              fill={Colors.harvest}
            >
              {amount}
            </SvgText>
          ) : null}
          <SvgText
            testID="harvest-share-date"
            x={PADDING}
            y={PHOTO_HEIGHT + 190}
            fontSize={40}
            fill={Colors.inkDim}
          >
            {date}
          </SvgText>

          <Line
            x1={PADDING}
            y1={PHOTO_HEIGHT + 240}
            x2={CARD_WIDTH - PADDING}
            y2={PHOTO_HEIGHT + 240}
            stroke={Colors.line}
            strokeWidth={2}
          />
          {/* R28 はアプリ名の露出も狙いのうち。URL は付けない（宣伝色が出ると共有されなくなる） */}
          <SvgText
            testID="harvest-share-brand"
            x={PADDING}
            y={PHOTO_HEIGHT + 316}
            fontSize={40}
            fill={Colors.inkDim}
          >
            さいえん手帳
          </SvgText>
        </Svg>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  frame: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.line,
    // 角丸は画面での見え方だけ。書き出す画像は viewBox どおりの四角になる
    overflow: 'hidden',
    backgroundColor: Colors.surface,
  },
});
