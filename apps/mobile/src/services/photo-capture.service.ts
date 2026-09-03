/**
 * PhotoCapture service — adapter boundary for camera/gallery image acquisition.
 *
 * `takenAt` は「EXIF の撮影日時があればそれ、無ければ選択/撮影した今」（2026-09-02）。
 * 写真から栽培登録するとき、育っている株を撮ると「今」を植え付け日にしてしまうと
 * 経過日数が最初から狂うため、撮影日を手がかりにする。EXIF の読み出しは
 * アダプタ（`expo-photo-capture.adapter.ts`）が担当し、**日付以外のフィールド
 * （特に GPS）はここまで運ばない** — #161 で原本 EXIF の GPS 座標を
 * サーバーへ送っていた欠陥を出しているため。
 */
export type PhotoCaptureSource = 'camera' | 'gallery';

export interface CapturedPhoto {
  localPath: string;
  source: PhotoCaptureSource;
  width?: number;
  height?: number;
  mimeType?: string;
  /**
   * EXIF から取れた撮影日時（ISO 8601）。アダプタが読み取れたときだけ入る。
   * GPS 等の位置情報は一切読まない・保持しない（#161 — サーバーへ原本の
   * GPS 入り EXIF を送っていた欠陥の教訓）。`takenAt` の元になるだけで、
   * それ以外の用途には使わない。
   */
  exifTakenAt?: string;
  takenAt: string;
  temporary: boolean;
}

export interface PhotoCaptureAdapter {
  captureFromCamera: () => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'> | null>;
  pickFromGallery: () => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'> | null>;
  /**
   * ギャラリーから**まとめて**選ぶ（栽培の一括登録 — #139 / #149）。
   * 任意実装。持たないアダプタでは `capturePhotos` が 1 枚選択にフォールバックする。
   */
  pickManyFromGallery?: (
    limit: number,
  ) => Promise<Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>[] | null>;
  deleteTemporaryFile?: (localPath: string) => Promise<void>;
  now?: () => string;
}

export class PhotoCaptureCancelledError extends Error {
  constructor() {
    super('Photo capture was cancelled');
    this.name = 'PhotoCaptureCancelledError';
  }
}

function stampPhoto(
  photo: Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>,
  source: PhotoCaptureSource,
  now: () => string,
): CapturedPhoto {
  return {
    ...photo,
    source,
    // EXIF の撮影日時があればそれを植え付け日推定の手がかりにする（既に育っている
    // 株を撮って登録すると「今日植えた」ことになり経過日数が最初から狂うため）。
    // 無ければ従来どおり選択/撮影した「今」を使う。
    takenAt: photo.exifTakenAt ?? now(),
    temporary: true,
  };
}

export async function capturePhoto(
  source: PhotoCaptureSource,
  adapter: PhotoCaptureAdapter,
): Promise<CapturedPhoto> {
  const now = adapter.now ?? (() => new Date().toISOString());
  const photo =
    source === 'camera' ? await adapter.captureFromCamera() : await adapter.pickFromGallery();
  if (!photo) throw new PhotoCaptureCancelledError();
  return stampPhoto(photo, source, now);
}

/**
 * ギャラリーから複数枚を取る。**一括登録の入口**（#139 / #149）。
 * アダプタが複数選択に対応していなければ 1 枚だけ返す（機能を殺さない）。
 * キャンセルは `PhotoCaptureCancelledError`。
 */
export async function capturePhotos(
  limit: number,
  adapter: PhotoCaptureAdapter,
): Promise<CapturedPhoto[]> {
  const now = adapter.now ?? (() => new Date().toISOString());
  if (!adapter.pickManyFromGallery) {
    const one = await adapter.pickFromGallery();
    if (!one) throw new PhotoCaptureCancelledError();
    return [stampPhoto(one, 'gallery', now)];
  }
  const photos = await adapter.pickManyFromGallery(limit);
  if (!photos || photos.length === 0) throw new PhotoCaptureCancelledError();
  return photos.map((photo) => stampPhoto(photo, 'gallery', now));
}

export async function cleanupTemporaryPhotos(
  photos: Pick<CapturedPhoto, 'localPath' | 'temporary'>[],
  adapter: Pick<PhotoCaptureAdapter, 'deleteTemporaryFile'>,
): Promise<void> {
  if (!adapter.deleteTemporaryFile) return;
  await Promise.all(
    photos
      .filter((photo) => photo.temporary)
      .map((photo) => adapter.deleteTemporaryFile?.(photo.localPath)),
  );
}
