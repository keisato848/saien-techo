/**
 * バックアップ・復元の画面テスト（WBS 2.8）。
 *
 * 復元は**現在の端末内データを置き換える**操作なので、確認を挟まずに走る経路が
 * 1 本でもあってはいけない。逆に、確認を通したのに走らない・結果が伝わらないのも
 * 同じくらい悪い（#92 は「復元は成功したのにトーストが消えて伝わらない」だった）。
 * ここでは確認の有無・成否の伝え方・押せない条件を固定する。
 *
 * ファイル入出力そのものはサービス側のテストで担保している。
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { BackupFileSummary } from '../../../src/services/backup.service';

const mockBack = jest.fn();
const mockRouter = { back: mockBack };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetDocumentAsync = jest.fn();
jest.mock('expo-document-picker', () => ({
  getDocumentAsync: (...args: unknown[]) => mockGetDocumentAsync(...args),
}));

const mockIsAvailableAsync = jest.fn();
const mockShareAsync = jest.fn();
jest.mock('expo-sharing', () => ({
  isAvailableAsync: (...args: unknown[]) => mockIsAvailableAsync(...args),
  shareAsync: (...args: unknown[]) => mockShareAsync(...args),
}));

const mockListLocalBackups = jest.fn();
const mockListMigrationBackupPackages = jest.fn();
const mockCreateLocalBackup = jest.fn();
const mockRestoreLatestLocalBackup = jest.fn();
const mockCreateMigrationBackupPackage = jest.fn();
const mockRestoreMigrationBackupPackage = jest.fn();
jest.mock('../../../src/services/backup.service', () => ({
  ...jest.requireActual('../../../src/services/backup.service'),
  listLocalBackups: (...args: unknown[]) => mockListLocalBackups(...args),
  listMigrationBackupPackages: (...args: unknown[]) => mockListMigrationBackupPackages(...args),
  createLocalBackup: (...args: unknown[]) => mockCreateLocalBackup(...args),
  restoreLatestLocalBackup: (...args: unknown[]) => mockRestoreLatestLocalBackup(...args),
  createMigrationBackupPackage: (...args: unknown[]) => mockCreateMigrationBackupPackage(...args),
  restoreMigrationBackupPackage: (...args: unknown[]) => mockRestoreMigrationBackupPackage(...args),
}));

import BackupScreen from '../backup';

function backupFile(overrides: Partial<BackupFileSummary> = {}): BackupFileSummary {
  return {
    uri: 'file:///backups/saien-2026-08-10.json',
    fileName: 'saien-2026-08-10.json',
    exportedAt: new Date(2026, 7, 10, 9, 30).toISOString(),
    sizeBytes: 2048,
    modifiedAt: 1,
    ...overrides,
  };
}

/** Alert.alert のボタンをラベルで押す。実機のダイアログの代わり */
function pressAlertButton(label: string) {
  const spy = Alert.alert as jest.Mock;
  const buttons = spy.mock.calls[spy.mock.calls.length - 1][2] as
    | { text: string; onPress?: () => void }[]
    | undefined;
  const button = buttons?.find((candidate) => candidate.text === label);
  if (!button) throw new Error(`ダイアログに「${label}」がありません`);
  // ダイアログのボタンは画面の外から呼ばれる。act で包まないと state 更新が警告になる
  act(() => button.onPress?.());
}

/** 直近の Alert のタイトル */
function lastAlertTitle(): string {
  const spy = Alert.alert as jest.Mock;
  return spy.mock.calls[spy.mock.calls.length - 1][0] as string;
}

beforeEach(() => {
  mockBack.mockReset();
  mockGetDocumentAsync.mockReset().mockResolvedValue({ canceled: true, assets: [] });
  mockIsAvailableAsync.mockReset().mockResolvedValue(true);
  mockShareAsync.mockReset().mockResolvedValue(undefined);
  mockListLocalBackups.mockReset().mockResolvedValue([]);
  mockListMigrationBackupPackages.mockReset().mockResolvedValue([]);
  mockCreateLocalBackup.mockReset().mockResolvedValue({ sizeBytes: 4096 });
  mockRestoreLatestLocalBackup.mockReset().mockResolvedValue({ fileName: 'saien-2026-08-10.json' });
  mockCreateMigrationBackupPackage.mockReset().mockResolvedValue({
    sizeBytes: 5 * 1024 * 1024,
    photoCount: 12,
  });
  mockRestoreMigrationBackupPackage.mockReset().mockResolvedValue({ restoredPhotoCount: 12 });
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('バックアップ — 状況の表示', () => {
  it('1 つも無ければ未作成と伝え、復元させない', async () => {
    render(<BackupScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('バックアップはまだありません')).toBeTruthy(), {
      timeout: 20_000,
    });
    expect(screen.getAllByText('未作成')).toHaveLength(2); // 通常 / 機種変更

    fireEvent.press(screen.getByText('最新バックアップから復元'));
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('最新の日時・ファイル名・サイズを出す', async () => {
    mockListLocalBackups.mockResolvedValue([backupFile()]);
    render(<BackupScreen />);

    await waitFor(() => expect(screen.getByText('2026/08/10 09:30')).toBeTruthy());
    expect(screen.getByText('saien-2026-08-10.json / 2.0 KB')).toBeTruthy();
  });

  it('自動バックアップの周期と保持数を伝える', async () => {
    render(<BackupScreen />);

    await waitFor(() => expect(screen.getByText(/7日ごとに/)).toBeTruthy());
    expect(screen.getByText(/4つ残します/)).toBeTruthy();
  });

  it('一覧の取得に失敗したら理由を伝える', async () => {
    mockListLocalBackups.mockRejectedValue(new Error('保存領域を読めません'));
    render(<BackupScreen />);

    await waitFor(() => expect(screen.getByText('保存領域を読めません')).toBeTruthy());
  });
});

describe('バックアップ — 作成', () => {
  it('作成したらサイズを添えて伝え、一覧を読み直す', async () => {
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('バックアップを作成')).toBeTruthy());
    const loadsBefore = mockListLocalBackups.mock.calls.length;

    fireEvent.press(screen.getByText('バックアップを作成'));

    await waitFor(() => expect(mockCreateLocalBackup).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText('バックアップを作成しました (4.0 KB)')).toBeTruthy(),
    );
    expect(mockListLocalBackups.mock.calls.length).toBeGreaterThan(loadsBefore);
  });

  it('作成に失敗したら理由をダイアログで出す', async () => {
    mockCreateLocalBackup.mockRejectedValue(new Error('空き容量がありません'));
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('バックアップを作成')).toBeTruthy());

    fireEvent.press(screen.getByText('バックアップを作成'));

    await waitFor(() => expect(lastAlertTitle()).toBe('バックアップできませんでした'));
  });
});

describe('バックアップ — 復元', () => {
  beforeEach(() => {
    mockListLocalBackups.mockResolvedValue([backupFile()]);
  });

  /**
   * 復元ボタンは最新バックアップが無いと disabled。ボタンの文字は読み込み前から
   * 出ているので、それを待っただけでは「押しても何も起きない」時点で押してしまう。
   * 一覧が入ったことを示す日時を待つ。
   */
  const waitForLoaded = () =>
    waitFor(() => expect(screen.getByText('2026/08/10 09:30')).toBeTruthy());

  // 端末内データを置き換える操作。確認なしで走る経路があってはいけない
  it('確認してから置き換え、結果を伝える', async () => {
    render(<BackupScreen />);
    await waitForLoaded();

    fireEvent.press(screen.getByText('最新バックアップから復元'));
    expect(mockRestoreLatestLocalBackup).not.toHaveBeenCalled();
    // いつのバックアップで置き換わるのかを確認文に出す
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('2026/08/10 09:30');

    pressAlertButton('復元する');

    await waitFor(() => expect(mockRestoreLatestLocalBackup).toHaveBeenCalled());
    // #92: 復元は成功したのにトーストが即消えして伝わらなかった
    await waitFor(() =>
      expect(screen.getByText('復元しました: saien-2026-08-10.json')).toBeTruthy(),
    );
  });

  it('キャンセルすれば置き換えない', async () => {
    render(<BackupScreen />);
    await waitForLoaded();

    fireEvent.press(screen.getByText('最新バックアップから復元'));
    pressAlertButton('キャンセル');

    expect(mockRestoreLatestLocalBackup).not.toHaveBeenCalled();
  });

  it('復元に失敗したら理由をダイアログで出す', async () => {
    mockRestoreLatestLocalBackup.mockRejectedValue(new Error('ファイルが壊れています'));
    render(<BackupScreen />);
    await waitForLoaded();

    fireEvent.press(screen.getByText('最新バックアップから復元'));
    pressAlertButton('復元する');

    await waitFor(() => expect(lastAlertTitle()).toBe('復元できませんでした'));
  });
});

describe('バックアップ — 機種変更（写真つき）', () => {
  it('作成したらサイズと写真枚数を添えて伝える', async () => {
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('移行ファイルを作成')).toBeTruthy());

    fireEvent.press(screen.getByText('移行ファイルを作成'));

    await waitFor(() =>
      expect(screen.getByText('移行ファイルを作成しました (5.0 MB / 写真12枚)')).toBeTruthy(),
    );
  });

  it('移行ファイルが無ければ共有させない', async () => {
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('最新移行ファイルを共有')).toBeTruthy());

    fireEvent.press(screen.getByText('最新移行ファイルを共有'));

    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('共有シートを使える端末なら、移行ファイルを渡す', async () => {
    mockListMigrationBackupPackages.mockResolvedValue([
      backupFile({ uri: 'file:///backups/saien-migration.zip', fileName: 'saien-migration.zip' }),
    ]);
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText(/saien-migration\.zip/)).toBeTruthy());

    fireEvent.press(screen.getByText('最新移行ファイルを共有'));

    await waitFor(() =>
      expect(mockShareAsync).toHaveBeenCalledWith(
        'file:///backups/saien-migration.zip',
        expect.objectContaining({ mimeType: 'application/zip' }),
      ),
    );
  });

  it('共有シートを使えない端末ならその旨を出す', async () => {
    mockListMigrationBackupPackages.mockResolvedValue([backupFile()]);
    mockIsAvailableAsync.mockResolvedValue(false);
    render(<BackupScreen />);
    // 読み込みが終わるまで共有ボタンは disabled
    await waitFor(() => expect(screen.getByText('2026/08/10 09:30')).toBeTruthy());

    fireEvent.press(screen.getByText('最新移行ファイルを共有'));

    await waitFor(() => expect(lastAlertTitle()).toBe('共有できません'));
    expect(mockShareAsync).not.toHaveBeenCalled();
  });

  it('ファイル選択をやめたら何も起きない', async () => {
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('移行ファイルから復元')).toBeTruthy());

    fireEvent.press(screen.getByText('移行ファイルから復元'));

    await waitFor(() => expect(mockGetDocumentAsync).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(mockRestoreMigrationBackupPackage).not.toHaveBeenCalled();
  });

  it('選んだファイル名を確認文に出してから置き換える', async () => {
    mockGetDocumentAsync.mockResolvedValue({
      canceled: false,
      assets: [{ name: 'saien-migration.zip', uri: 'file:///picked/saien-migration.zip' }],
    });
    render(<BackupScreen />);
    await waitFor(() => expect(screen.getByText('移行ファイルから復元')).toBeTruthy());

    fireEvent.press(screen.getByText('移行ファイルから復元'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('saien-migration.zip');
    expect(mockRestoreMigrationBackupPackage).not.toHaveBeenCalled();

    pressAlertButton('復元する');

    await waitFor(() =>
      expect(mockRestoreMigrationBackupPackage).toHaveBeenCalledWith(
        'file:///picked/saien-migration.zip',
      ),
    );
    await waitFor(() =>
      expect(screen.getByText('移行ファイルから復元しました (写真12枚)')).toBeTruthy(),
    );
  });
});
