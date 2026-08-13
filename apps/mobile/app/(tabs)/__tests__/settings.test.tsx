/**
 * 設定画面の主要導線（S15 / WBS 3.5〜3.7）。
 *
 * 広告のプライバシー設定 1 行だけは `settings-ad-privacy.test.tsx` が担保している。
 * ここで見るのは残りの行 — **場所・資材・地域・バックアップ・ライセンスへの遷移**、
 * **未実装の行が押せないこと**（プロフィール編集・クラウド同期）、
 * 使い方ガイドの再表示、地域の表示切り替え。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

jest.mock('../../../src/services/app-open-ad.service', () => ({
  getAppOpenAdProvider: () => ({
    isPrivacyOptionsRequired: () => Promise.resolve(false),
    showPrivacyOptionsForm: () => Promise.resolve(),
  }),
}));

jest.mock('../../../src/services/user.service', () => ({
  getCurrentUser: () => ({ id: 'u1', displayName: '恵' }),
  getCurrentFamily: () => ({ id: 'f1', name: 'わたしの菜園' }),
  getCurrentUserProfile: () => Promise.resolve({ id: 'u1', displayName: '恵' }),
  getCurrentFamilyProfile: () => Promise.resolve({ id: 'f1', name: 'わたしの菜園' }),
}));

const mockGetRegion = jest.fn();
jest.mock('../../../src/services/region.service', () => ({
  ...jest.requireActual('../../../src/services/region.service'),
  getRegion: (...args: unknown[]) => mockGetRegion(...args),
}));

const mockResetCoachMarks = jest.fn();
jest.mock('../../../src/services/coach-marks.service', () => ({
  ...jest.requireActual('../../../src/services/coach-marks.service'),
  shouldShowCoachMarks: () => Promise.resolve(false),
  markCoachMarksSeen: () => Promise.resolve(),
  resetCoachMarks: (...args: unknown[]) => mockResetCoachMarks(...args),
}));

import SettingsScreen from '../settings';

beforeEach(() => {
  mockPush.mockReset();
  mockGetRegion.mockReset().mockResolvedValue(null);
  mockResetCoachMarks.mockReset().mockResolvedValue(undefined);
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('設定 — 菜園セクション', () => {
  it('場所の管理へ飛ぶ', async () => {
    render(<SettingsScreen />);
    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText('場所の管理')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.press(screen.getByText('場所の管理'));
    expect(mockPush).toHaveBeenCalledWith('/places');
  });

  it('資材の在庫へ飛ぶ', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('資材の在庫')).toBeTruthy());

    fireEvent.press(screen.getByText('資材の在庫'));
    expect(mockPush).toHaveBeenCalledWith('/materials');
  });

  it('お住まいの地域へ飛ぶ', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('お住まいの地域')).toBeTruthy());

    fireEvent.press(screen.getByText('お住まいの地域'));
    expect(mockPush).toHaveBeenCalledWith('/region');
  });

  it('地域が未設定なら「中間地として表示」を伝える', async () => {
    mockGetRegion.mockResolvedValue(null);
    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(/未設定（中間地として表示します）/)).toBeTruthy());
  });

  it('地域を設定していれば、その地域名の栽培暦だと伝える', async () => {
    mockGetRegion.mockResolvedValue('warm');
    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(/暖地の栽培暦で表示します/)).toBeTruthy());
  });
});

describe('設定 — データセクション', () => {
  it('バックアップ・復元へ飛ぶ', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('バックアップ・復元')).toBeTruthy());

    fireEvent.press(screen.getByText('バックアップ・復元'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/backup');
  });

  // 未実装の行。押しても遷移せず「準備中」と伝える — 押しても何も起きないままにしない
  it('クラウド同期は「今後追加予定」を出し、押すと準備中と伝える', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('クラウド同期')).toBeTruthy());
    expect(screen.getByText('今後追加予定')).toBeTruthy();

    fireEvent.press(screen.getByText('クラウド同期'));

    expect(Alert.alert).toHaveBeenCalledWith(
      '準備中',
      'この機能は今後のバージョンで追加予定です。',
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('設定 — アプリセクション', () => {
  it('ライセンス情報へ飛ぶ', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('ライセンス情報')).toBeTruthy());

    fireEvent.press(screen.getByText('ライセンス情報'));
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/licenses');
  });

  it('使い方ガイドを再表示すると、リセットして案内を伝える', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('使い方ガイドを再表示')).toBeTruthy());

    fireEvent.press(screen.getByText('使い方ガイドを再表示'));

    await waitFor(() => expect(mockResetCoachMarks).toHaveBeenCalled());
    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '使い方ガイド',
        '各画面を開くと操作案内が再表示されます。',
      ),
    );
  });

  it('バージョンは表示のみで押せない', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText(/^v/)).toBeTruthy());

    fireEvent.press(screen.getByText(/^v/));
    expect(mockPush).not.toHaveBeenCalled();
  });
});

describe('設定 — アカウントセクション', () => {
  // WBS 3.6（設定画面の作り直し）まで未実装。押せることを期待させない
  it('プロフィール編集は押せない（未実装）', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('プロフィール編集')).toBeTruthy());

    fireEvent.press(screen.getByText('プロフィール編集'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('利用者名と菜園名を出す', async () => {
    render(<SettingsScreen />);

    // Avatar が頭文字も「恵」として出すため、名前が重複して見える。件数で見る
    await waitFor(() => expect(screen.getAllByText('恵').length).toBeGreaterThan(0));
    expect(screen.getByText('わたしの菜園')).toBeTruthy();
  });
});
