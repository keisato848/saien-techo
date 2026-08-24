import * as ImagePicker from 'expo-image-picker';

import type { CapturedPhoto, PhotoCaptureAdapter } from './photo-capture.service';

type RawCapturedPhoto = Omit<CapturedPhoto, 'source' | 'takenAt' | 'temporary'>;

function toCapturedPhoto(asset: ImagePicker.ImagePickerAsset | undefined): RawCapturedPhoto | null {
  if (!asset) return null;
  return {
    localPath: asset.uri,
    width: asset.width,
    height: asset.height,
    mimeType: asset.mimeType,
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
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: false,
      allowsMultipleSelection: true,
      selectionLimit: limit,
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled) return null;
    return result.assets
      .map((asset) => toCapturedPhoto(asset))
      .filter((photo): photo is RawCapturedPhoto => photo !== null);
  },
};
