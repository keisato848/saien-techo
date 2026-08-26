import {
  resolvePhotoUri,
  resolvePhotoUriOrNull,
  resolvePhotoUris,
  toStoredPhotoPath,
  toStoredPhotoPathOrNull,
} from '../photo-path';

const DOC = 'file:///var/mobile/Containers/Data/Application/AAAA-1111/Documents/';

describe('toStoredPhotoPath', () => {
  it('絶対パスから既知のディレクトリ以降を切り出す', () => {
    expect(toStoredPhotoPath(`${DOC}garden-photos/garden-photo-2026-1.jpg`)).toBe(
      'garden-photos/garden-photo-2026-1.jpg',
    );
    expect(toStoredPhotoPath(`${DOC}recipe-photos/recipe-photo-2.jpg`)).toBe(
      'recipe-photos/recipe-photo-2.jpg',
    );
    expect(toStoredPhotoPath('/data/user/0/com.saientecho.app/files/backup-photos/x.jpg')).toBe(
      'backup-photos/x.jpg',
    );
  });

  it('すでに相対パスならそのまま', () => {
    expect(toStoredPhotoPath('garden-photos/a.jpg')).toBe('garden-photos/a.jpg');
  });

  it('知らない場所を指す絶対パスは切り詰めない（復元不能を避ける）', () => {
    expect(toStoredPhotoPath('file:///tmp/ImagePicker/abc.jpg')).toBe(
      'file:///tmp/ImagePicker/abc.jpg',
    );
  });

  it('ディレクトリ名が複数回現れても最後の 1 つで切る', () => {
    expect(toStoredPhotoPath(`${DOC}garden-photos/old/garden-photos/b.jpg`)).toBe(
      'garden-photos/b.jpg',
    );
  });

  it('null を素通しする', () => {
    expect(toStoredPhotoPathOrNull(null)).toBeNull();
    expect(toStoredPhotoPathOrNull(undefined)).toBeNull();
    expect(toStoredPhotoPathOrNull('garden-photos/a.jpg')).toBe('garden-photos/a.jpg');
  });
});

describe('resolvePhotoUri', () => {
  it('相対パスに documentDirectory を付ける', () => {
    expect(resolvePhotoUri('garden-photos/a.jpg', DOC)).toBe(`${DOC}garden-photos/a.jpg`);
  });

  it('v13 前に保存された絶対パスはそのまま返す', () => {
    const legacy = `${DOC}garden-photos/legacy.jpg`;
    expect(resolvePhotoUri(legacy, DOC)).toBe(legacy);
  });

  it('documentDirectory が無い環境（web）でも落ちない', () => {
    expect(resolvePhotoUri('garden-photos/a.jpg', null)).toBe('garden-photos/a.jpg');
  });

  it('往復して同じ値に戻る', () => {
    const absolute = `${DOC}garden-photos/a.jpg`;
    expect(resolvePhotoUri(toStoredPhotoPath(absolute), DOC)).toBe(absolute);
  });

  it('null と配列も扱える', () => {
    expect(resolvePhotoUriOrNull(null, DOC)).toBeNull();
    expect(resolvePhotoUris(['garden-photos/a.jpg', 'garden-photos/b.jpg'], DOC)).toEqual([
      `${DOC}garden-photos/a.jpg`,
      `${DOC}garden-photos/b.jpg`,
    ]);
  });
});
