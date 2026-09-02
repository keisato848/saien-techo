import * as ImagePicker from 'expo-image-picker';

import { expoImagePickerPhotoCaptureAdapter } from '../expo-photo-capture.adapter';

jest.mock('expo-image-picker', () => ({
  MediaTypeOptions: { Images: 'Images' },
  PermissionStatus: { DENIED: 'denied' },
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

const mockedImagePicker = ImagePicker as jest.Mocked<typeof ImagePicker>;

describe('OCR-REQ-01 Expo photo capture adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not launch the camera when camera permission is denied', async () => {
    mockedImagePicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
      canAskAgain: false,
      expires: 'never',
      status: ImagePicker.PermissionStatus.DENIED,
    });

    await expect(expoImagePickerPhotoCaptureAdapter.captureFromCamera()).rejects.toThrow(
      'カメラの使用が許可されていません',
    );
    expect(mockedImagePicker.launchCameraAsync).not.toHaveBeenCalled();
  });

  it('opens the gallery via the system photo picker without requesting media library permission', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    });

    await expoImagePickerPhotoCaptureAdapter.pickFromGallery();

    expect(mockedImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(mockedImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
  });
});

// 撮影日（EXIF）を植え付け日の手がかりにする（写真から栽培登録・2026-09-02）。
// GPS 等の他フィールドには一切触れないので、ここでは日付キーの抽出だけを見る。
describe('pickManyFromGallery の EXIF 撮影日時', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exif: true を渡す（撮影日時を読むため）', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });

    await expoImagePickerPhotoCaptureAdapter.pickManyFromGallery?.(10);

    expect(mockedImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ exif: true }),
    );
  });

  it('DateTimeOriginal（EXIF 標準の区切り）を優先して読む', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'a.jpg',
          exif: {
            DateTimeOriginal: '2026:05:01 10:20:30',
            DateTime: '2026:06:01 00:00:00',
            GPSLatitude: 35.0, // 触れられていないことを他のテストで確認する
          },
        },
      ],
    });

    const result = await expoImagePickerPhotoCaptureAdapter.pickManyFromGallery?.(10);

    // EXIF の日時にタイムゾーンは無い（端末のローカル時刻）ので、端末のロケールで
    // 解釈した値と比べる — テスト環境のタイムゾーンに依存させないため
    expect(result?.[0]).toMatchObject({
      localPath: 'a.jpg',
      exifTakenAt: new Date(2026, 4, 1, 10, 20, 30).toISOString(),
    });
  });

  it('DateTimeOriginal が無ければ DateTime、それも無ければ CreationDate の順で見る', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'a.jpg', exif: { DateTime: '2026:04:10 09:00:00' } },
        { uri: 'b.jpg', exif: { CreationDate: '2026-03-15T08:00:00.000Z' } },
      ],
    });

    const result = await expoImagePickerPhotoCaptureAdapter.pickManyFromGallery?.(10);

    expect(result?.[0].exifTakenAt).toBe(new Date(2026, 3, 10, 9, 0, 0).toISOString());
    // こちらは元から 'Z' 付き（UTC）で来ているので、そのままの解釈でよい
    expect(result?.[1].exifTakenAt).toBe('2026-03-15T08:00:00.000Z');
  });

  it('EXIF が無い・壊れているときは exifTakenAt を付けない（now() へフォールバックさせる）', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        { uri: 'no-exif.jpg', exif: null },
        { uri: 'broken.jpg', exif: { DateTimeOriginal: 'not-a-date' } },
      ],
    });

    const result = await expoImagePickerPhotoCaptureAdapter.pickManyFromGallery?.(10);

    expect(result?.[0].exifTakenAt).toBeUndefined();
    expect(result?.[1].exifTakenAt).toBeUndefined();
  });

  it('GPS 系のフィールドは結果に一切含めない（#161 の教訓）', async () => {
    mockedImagePicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [
        {
          uri: 'a.jpg',
          exif: { DateTimeOriginal: '2026:05:01 10:20:30', GPSLatitude: 35.6, GPSLongitude: 139.7 },
        },
      ],
    });

    const result = await expoImagePickerPhotoCaptureAdapter.pickManyFromGallery?.(10);

    const keys = Object.keys(result?.[0] ?? {});
    expect(keys.some((key) => key.toLowerCase().includes('gps'))).toBe(false);
  });
});
