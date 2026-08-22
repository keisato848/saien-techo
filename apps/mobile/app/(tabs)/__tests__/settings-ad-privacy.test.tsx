/**
 * 設定の「広告のプライバシー設定」行（§8.2 / WBS 3.7）。
 *
 * この行は UMP が「同意のやり直し導線が要る地域」と判定したときだけ出す。
 * 日本では出ないので、**実機で見ても「出ない」ことしか確かめられない**。
 * 出ないのが正しい判定の結果なのか、単に壊れて何も起きていないのかを
 * 区別できないため、条件分岐そのものはここで固定する。
 *
 * UMP の地域判定そのものは SDK の振る舞いなので対象外。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockIsPrivacyOptionsRequired = jest.fn();
const mockShowPrivacyOptionsForm = jest.fn();
jest.mock('../../../src/services/app-open-ad.service', () => ({
  getAppOpenAdProvider: () => ({
    isPrivacyOptionsRequired: () => mockIsPrivacyOptionsRequired(),
    showPrivacyOptionsForm: () => mockShowPrivacyOptionsForm(),
  }),
}));

jest.mock('../../../src/services/user.service', () => ({
  getCurrentUser: () => ({ id: 'u1', displayName: '' }),
  getCurrentFamily: () => ({ id: 'f1', name: 'わたしの菜園' }),
  getCurrentUserProfile: () => Promise.resolve({ id: 'u1', displayName: '' }),
  getCurrentFamilyProfile: () => Promise.resolve({ id: 'f1', name: 'わたしの菜園' }),
}));

jest.mock('../../../src/services/region.service', () => ({
  ...jest.requireActual('../../../src/services/region.service'),
  getRegion: () => Promise.resolve('temperate'),
}));

jest.mock('../../../src/services/coach-marks.service', () => ({
  ...jest.requireActual('../../../src/services/coach-marks.service'),
  resetCoachMarks: () => Promise.resolve(),
}));

jest.mock('../../../src/hooks/useCoachMarks', () => ({
  useCoachMarks: () => ({ show: jest.fn(), visible: false, marks: [], current: 0 }),
}));

import SettingsScreen from '../settings';

const ROW = '広告のプライバシー設定';

beforeEach(() => {
  mockPush.mockReset();
  mockIsPrivacyOptionsRequired.mockReset().mockResolvedValue(false);
  mockShowPrivacyOptionsForm.mockReset().mockResolvedValue(undefined);
});

describe('広告のプライバシー設定', () => {
  it('要らない地域では行ごと出さない（押せない行を並べない）', async () => {
    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText('ライセンス情報')).toBeTruthy());
    expect(screen.queryByText(ROW)).toBeNull();
  });

  it('要る地域では行を出す', async () => {
    mockIsPrivacyOptionsRequired.mockResolvedValue(true);
    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(ROW)).toBeTruthy());
  });

  it('押すと UMP のフォームを開く', async () => {
    mockIsPrivacyOptionsRequired.mockResolvedValue(true);
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText(ROW)).toBeTruthy());

    fireEvent.press(screen.getByText(ROW));

    await waitFor(() => expect(mockShowPrivacyOptionsForm).toHaveBeenCalled());
  });

  it('判定に失敗したら出さない（設定画面を壊さない）', async () => {
    mockIsPrivacyOptionsRequired.mockRejectedValue(new Error('boom'));
    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText('ライセンス情報')).toBeTruthy());
    expect(screen.queryByText(ROW)).toBeNull();
  });
});
