/**
 * サーバーへ送る写真の準備（縮小 + base64 化）。
 *
 * 原寸のカメラ写真（2〜5MB）をそのまま base64 にするとリクエストが数 MB に
 * 膨らむため、長辺 1024px へ縮小してから送る（読み取り・診断には十分）。
 * `expo-image-manipulator` は JPEG へ**再エンコード**するので、送信画像に
 * EXIF（GPS 座標など）は残らない — ここが崩れると自宅の位置が外へ出る。
 *
 * garden-consult.service.ts の adapter と同じ処理だが、あちらは安定稼働中の
 * コードなので触らず、こちらを新設した。統合するなら consult 側をこれに
 * 寄せる方向で（逆はしない）。
 */
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export const UPLOAD_MAX_DIMENSION = 1024;
export const UPLOAD_JPEG_QUALITY = 0.7;

export interface UploadImage {
  base64: string;
  mimeType: string;
}

export interface UploadImageAdapter {
  prepare(uri: string): Promise<UploadImage>;
}

export const expoUploadImageAdapter: UploadImageAdapter = {
  async prepare(uri) {
    let sendUri = uri;
    try {
      const context = ImageManipulator.manipulate(uri);
      const original = await context.renderAsync();
      if (Math.max(original.width, original.height) > UPLOAD_MAX_DIMENSION) {
        context.resize(
          original.width >= original.height
            ? { width: UPLOAD_MAX_DIMENSION }
            : { height: UPLOAD_MAX_DIMENSION },
        );
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        format: SaveFormat.JPEG,
        compress: UPLOAD_JPEG_QUALITY,
      });
      sendUri = saved.uri;
    } catch {
      // 縮小に失敗しても原本で続行する（サイズ上限はサーバー側でも見ている）
    }
    const base64 = await FileSystem.readAsStringAsync(sendUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return { base64, mimeType: 'image/jpeg' };
  },
};
