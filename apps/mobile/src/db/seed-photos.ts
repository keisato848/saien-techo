/**
 * サンプルデータ用の写真投入（ストア掲載素材・WBS 3.8）
 *
 * **サンプルデータを有効にしたビルドでしか動かない。** 実利用者の端末では
 * seedDatabase 自体が即 return するのでここへは来ない。
 *
 * ## なぜ同梱の画像を copy するのか
 *
 * 収穫アルバム（R07）は「写真で振り返る」画面なので、写真ゼロだと
 * 籠アイコンだけが並ぶ。掲載スクリーンショットとして訴求が死ぬ。
 * かといって実物らしい写真は生成できないので、実際の菜園の写真を同梱している。
 *
 * 表示は `photos.local_path` を `<Image source={{uri}}>` に渡す作りなので、
 * バンドル内の asset URI をそのまま入れる手もある。**しない**のは、
 * asset URI が実行環境（dev / release / OS）で形が変わり、
 * リリースビルドだけ画像が出ない事故になりやすいため。
 * 通常の写真と同じく garden-photos/ へ複製して、経路を 1 本にする。
 *
 * ## 同梱している写真について
 *
 * 提供された実写真から**位置情報・端末情報を含む EXIF をすべて除去**してある
 * （sharp で再エンコード。生バイト列に GPS/端末名の痕跡が無いことも確認済み）。
 * 差し替えるときも同じ処理を通すこと — スマホの写真は既定で自宅の座標を持つ。
 */
import { eq } from 'drizzle-orm';
import type { ExpoSQLiteDatabase } from 'drizzle-orm/expo-sqlite';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';

import * as schema from './schema';

type DB = ExpoSQLiteDatabase<typeof schema>;

/** 投入する写真と、結び付ける先 */
interface SamplePhoto {
  /**
   * photos.id と複製先のファイル名に使う固定 ID。
   *
   * **generateId() を使ってはいけない。** 他のシードは固定 ID + onConflictDoNothing で
   * 冪等だが、写真をランダム ID にすると SAMPLE_DATA_VERSION を上げるたびに
   * 4 枚ずつ増える。再シードは必ず起きる（版を上げるのがシードの更新手段なので）。
   */
  id: string;
  /** require() の戻り（Metro が解決する） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  module: any;
  ownerType: 'harvest' | 'care_log' | 'planting';
  ownerId: string;
  /** plantings.cover_photo_path にも入れるか */
  asCover?: boolean;
}

const SAMPLE_PHOTOS: SamplePhoto[] = [
  {
    id: 'sample-photo-harvest-01',
    module: require('../../assets/sample-photos/harvest-tomato.jpg'),
    ownerType: 'harvest',
    ownerId: 'harvest-01',
  },
  {
    // 「写真の読み取り」の確認カード（#148・ストア掲載スクショ 08）。
    // **同じアセットを使い回す** — harvest-01 と同じ require なので APK は増えない。
    // ここが空だと、写真が主役の機能なのに掲載物では灰色の枠しか写らない。
    id: 'sample-photo-harvest-02',
    module: require('../../assets/sample-photos/harvest-tomato.jpg'),
    ownerType: 'harvest',
    ownerId: 'harvest-02',
  },
  {
    id: 'sample-photo-planting-01',
    module: require('../../assets/sample-photos/planting-tomato.jpg'),
    ownerType: 'planting',
    ownerId: 'planting-tomato-01',
    asCover: true,
  },
  {
    id: 'sample-photo-care-01',
    module: require('../../assets/sample-photos/care-planter.jpg'),
    ownerType: 'care_log',
    ownerId: 'care-log-01',
  },
  {
    id: 'sample-photo-care-03',
    module: require('../../assets/sample-photos/care-seedling.jpg'),
    ownerType: 'care_log',
    ownerId: 'care-log-03',
  },
];

/**
 * 同梱写真を端末へ複製し、photos 行と栽培のカバー写真を作る。
 *
 * 失敗しても投げない。**写真が出ないだけでアプリは使える**ので、
 * サンプルデータの投入全体を巻き込んで落とすほうが害が大きい。
 */
export async function seedSamplePhotos(database: DB): Promise<void> {
  const directory = `${FileSystem.documentDirectory ?? ''}garden-photos/`;
  if (!FileSystem.documentDirectory) return;

  try {
    const info = await FileSystem.getInfoAsync(directory);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
    }
  } catch {
    return;
  }

  const now = new Date().toISOString();
  let sortOrder = 0;

  for (const sample of SAMPLE_PHOTOS) {
    try {
      // 複製先も固定名。再シードで同じ場所を上書きするので増えない
      const destination = `${directory}${sample.id}.jpg`;
      const existing = await FileSystem.getInfoAsync(destination);
      if (!existing.exists) {
        const asset = Asset.fromModule(sample.module);
        await asset.downloadAsync();
        const source = asset.localUri ?? asset.uri;
        if (!source) continue;
        await FileSystem.copyAsync({ from: source, to: destination });
      }

      if (sample.ownerType === 'planting' && sample.asCover) {
        await database
          .update(schema.plantings)
          .set({ coverPhotoPath: destination, updatedAt: now })
          .where(eq(schema.plantings.id, sample.ownerId));
      }

      await database
        .insert(schema.photos)
        .values({
          id: sample.id,
          ownerType: sample.ownerType,
          ownerId: sample.ownerId,
          localPath: destination,
          width: 1200,
          height: 1200,
          sortOrder: sortOrder++,
          createdAt: now,
        })
        .onConflictDoNothing();
    } catch {
      // この 1 枚を諦めて次へ。写真が無くても画面は成立する
    }
  }
}
