/**
 * 地域の設定画面のテスト（§9 / WBS 3.6）。
 * 見るのは**保存の即時性**: 選んだ瞬間に setRegion が呼ばれるか。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetRegion = jest.fn();
const mockSetRegion = jest.fn();
jest.mock('../../../src/services/region.service', () => ({
  ...jest.requireActual('../../../src/services/region.service'),
  getRegion: (...args: unknown[]) => mockGetRegion(...args),
  setRegion: (...args: unknown[]) => mockSetRegion(...args),
}));

import RegionScreen from '../region';

describe('地域の設定画面', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockGetRegion.mockReset().mockResolvedValue(null);
    mockSetRegion.mockReset().mockResolvedValue(undefined);
  });

  it('保存済みの地域が選択された状態で出る', async () => {
    mockGetRegion.mockResolvedValue('warm');
    render(<RegionScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText('暖地').props.accessibilityState.selected).toBe(true),
    );
  });

  it('未設定なら既定の中間地が選ばれている', async () => {
    render(<RegionScreen />);

    await waitFor(() => expect(mockGetRegion).toHaveBeenCalled());
    expect(screen.getByLabelText('中間地').props.accessibilityState.selected).toBe(true);
  });

  it('選んだ瞬間に保存する（保存ボタンを挟まない）', async () => {
    render(<RegionScreen />);
    await waitFor(() => expect(mockGetRegion).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('寒冷地'));

    expect(mockSetRegion).toHaveBeenCalledWith('cold');
    expect(screen.getByLabelText('寒冷地').props.accessibilityState.selected).toBe(true);
  });

  it('戻るで前の画面へ', async () => {
    render(<RegionScreen />);
    await waitFor(() => expect(mockGetRegion).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText('戻る'));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
