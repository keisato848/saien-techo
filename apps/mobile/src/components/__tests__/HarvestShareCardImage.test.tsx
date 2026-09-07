/**
 * 収穫カード（R28 / WBS 4.10 / #41）。
 *
 * **このカードは「見た目」ではなく「外へ出る中身」**。Android の共有は
 * 写真かことばの片方しか運べないので、作物名・数量・日付・アプリ名が
 * この 1 枚に載っていなければ、受け取った人には何も伝わらない。
 * ここではその 4 つが必ず描かれることを固定する。
 */
import { render, screen } from '@testing-library/react-native';

import { HarvestShareCardImage } from '../HarvestShareCardImage';
import type { HarvestShareCard } from '../../services/harvest-share.service';

/**
 * SVG の `<Text>` は中身を `<TSpan>` で包むので、props.children に文字列が
 * そのまま入っていない。カードに「何と描かれたか」で見たいので、たどって拾う。
 */
interface ElementLike {
  props: { children?: unknown };
}

function isElementLike(value: unknown): value is ElementLike {
  return typeof value === 'object' && value !== null && 'props' in value;
}

function collectText(children: unknown): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(collectText).join('');
  if (isElementLike(children)) return collectText(children.props.children);
  return '';
}

function cardText(testID: string): string {
  return collectText(screen.getByTestId(testID).props.children);
}

function card(overrides: Partial<HarvestShareCard> = {}): HarvestShareCard {
  return {
    harvestId: 'h1',
    plantingId: 'p1',
    cropName: 'キュウリ',
    variety: null,
    harvestedAt: '2026-09-07T02:00:00.000Z',
    quantity: 3,
    unit: 'piece',
    photoUri: 'file:///documents/garden-photos/a.jpg',
    photoCount: 1,
    ...overrides,
  };
}

describe('HarvestShareCardImage', () => {
  it('作物名・数量・日付・アプリ名をカードへ焼き込む', () => {
    render(<HarvestShareCardImage card={card()} photoUri="file:///cache/safe.jpg" width={320} />);

    expect(cardText('harvest-share-title')).toBe('キュウリ');
    expect(cardText('harvest-share-amount')).toBe('3個');
    expect(cardText('harvest-share-date')).toBe('2026年9月7日');
    // R28 はアプリ名の露出も狙いのうち。ここが落ちると獲得チャネルにならない
    expect(cardText('harvest-share-brand')).toBe('さいえん手帳');
  });

  it('品種も見出しに入れる', () => {
    render(
      <HarvestShareCardImage
        card={card({ variety: '夏すずみ' })}
        photoUri="file:///cache/safe.jpg"
        width={320}
      />,
    );

    expect(cardText('harvest-share-title')).toBe('キュウリ（夏すずみ）');
  });

  /**
   * SVG の `<Text>` は折り返しも省略もしない。畳まずに描くと、はみ出した分が
   * そのままカードの外に描かれた状態で書き出される。
   */
  it('長すぎる見出しは畳んでから描く', () => {
    render(
      <HarvestShareCardImage
        card={card({ cropName: 'ミニトマト', variety: 'アイコとキャロルの混植' })}
        photoUri="file:///cache/safe.jpg"
        width={320}
      />,
    );

    const title = cardText('harvest-share-title');
    expect(title).toHaveLength(14);
    expect(title.endsWith('…')).toBe(true);
  });

  /**
   * **原本ではなく、位置情報を落とした uri を焼き込む。** 画面が渡した uri を
   * そのまま描くので、ここが原本になっていると GPS 付きの画素が外へ出る。
   */
  it('渡された写真だけを描く（原本を自分で読みに行かない）', () => {
    render(
      <HarvestShareCardImage card={card()} photoUri="file:///cache/share/safe.jpg" width={320} />,
    );

    expect(screen.getByTestId('harvest-share-photo').props.src).toMatchObject({
      uri: 'file:///cache/share/safe.jpg',
    });
    expect(screen.queryByTestId('harvest-share-photoless')).toBeNull();
  });

  it('写真の描画が終わったら知らせる（画面はこれを待って共有を許す）', () => {
    const onPhotoLoad = jest.fn();
    render(
      <HarvestShareCardImage
        card={card()}
        photoUri="file:///cache/safe.jpg"
        onPhotoLoad={onPhotoLoad}
        width={320}
      />,
    );

    screen.getByTestId('harvest-share-photo').props.onLoad();
    expect(onPhotoLoad).toHaveBeenCalled();
  });

  // 写真の無い収穫（数量だけ）も R06 の正常系。空の枠を出すと壊れて見える
  it('写真が無ければ数量を主役にしたカードにする', () => {
    render(<HarvestShareCardImage card={card({ photoUri: null })} photoUri={null} width={320} />);

    expect(screen.getByTestId('harvest-share-photoless')).toBeTruthy();
    expect(cardText('harvest-share-hero')).toBe('3個');
    expect(screen.queryByTestId('harvest-share-photo')).toBeNull();
    // ことばは写真の有無に関わらず載る
    expect(cardText('harvest-share-title')).toBe('キュウリ');
    expect(cardText('harvest-share-brand')).toBe('さいえん手帳');
  });

  it('写真も数量も無ければ「収穫」と描く', () => {
    render(
      <HarvestShareCardImage
        card={card({ photoUri: null, quantity: null, unit: null })}
        photoUri={null}
        width={320}
      />,
    );

    expect(cardText('harvest-share-hero')).toBe('収穫');
    expect(screen.queryByTestId('harvest-share-amount')).toBeNull();
  });
});
