/**
 * PhotoCapture service — adapter boundary for camera/gallery image acquisition.
 */
export type PhotoCaptureSource = 'camera' | 'gallery';

export interface CapturedPhoto {
  localPath: string;
  source: PhotoCaptureSource;
  width?: number;
  height?: number;
  mimeType?: string;
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
    takenAt: now(),
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
