import * as ImagePicker from 'expo-image-picker';

import type { CapturedPhoto, PhotoCaptureAdapter } from './photo-capture.service';

type RawCapturedPhoto = Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>;

/**
 * EXIF の撮影日時タグを端末差を吸収しながら読む。
 *
 * `DateTimeOriginal`（撮影時刻）→ `DateTime`（更新時刻・無いよりまし）→
 * `CreationDate`（一部端末/形式のみ）の順で見る。値は EXIF 標準の
 * `"YYYY:MM:DD HH:MM:SS"`（コロン区切り）で来ることが多いが、ISO 形式で
 * 来る端末もあるため両方をパースする。
 *
 * **ここで読むのはこの 3 キーの「文字列」だけ。** `exif` オブジェクトには
 * GPS 座標などが同居しうるが、それらには一切触れず、返り値にも含めない
 * （#161 の教訓 — 読み出しも保持も禁止）。
 */
function parseExifDateString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  const exifFormat = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(trimmed);
  const isoLike = exifFormat
    ? `${exifFormat[1]}-${exifFormat[2]}-${exifFormat[3]}T${exifFormat[4]}:${exifFormat[5]}:${exifFormat[6]}`
    : trimmed;

  const date = new Date(isoLike);
  // 壊れた値は黙って捨てる（呼び出し側が now() にフォールバックする）
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function exifTakenAtFrom(exif: Record<string, unknown> | null | undefined): string | undefined {
  if (!exif) return undefined;
  return (
    parseExifDateString(exif.DateTimeOriginal) ??
    parseExifDateString(exif.DateTime) ??
    parseExifDateString(exif.CreationDate)
  );
}

function toCapturedPhoto(asset: ImagePicker.ImagePickerAsset | undefined): RawCapturedPhoto | null {
  if (!asset) return null;
  const exifTakenAt = exifTakenAtFrom(asset.exif);
  return {
    localPath: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
    ...(exifTakenAt !== undefined && { exifTakenAt }),
  };
}

async function ensureCameraPermission(): Promise<void> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('カメラの使用が許可されていません');
}

export const expoImagePickerPhotoCaptureAdapter: PhotoCaptureAdapter = {
  async captureFromCamera() {
    await ensureCameraPermission();
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 1,
    });
    return result.canceled ? null : toCapturedPhoto(result.assets[0]);
  },
  async pickFromGallery() {
    // Uses the system Photo Picker (Android 13+ / iOS 14+), which grants
    // scoped access to the selected item without requiring a media-library
    // permission.
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      mediaTypes: ['images'],
      quality: 1,
    });
    return result.canceled ? null : toCapturedPhoto(result.assets[0]);
  },
  async pickManyFromGallery(limit) {
    // 一括登録（#139 / #149）。システムの Photo Picker が複数選択に対応している。
    // exif: true は撮影日時を植え付け日の手がかりにするため（2026-09-02）。
    // GPS 等も一緒に返ってくるが、toCapturedPhoto が日付以外を読まずに捨てる。
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      mediaTypes: ['images'],
      quality: 1,
      exif: true,
    });
    if (result.canceled) return null;
    return result.assets
      .map((asset) => toCapturedPhoto(asset))
      .filter((photo): photo is RawCapturedPhoto => photo !== null);
  },
};
