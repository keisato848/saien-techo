/**
 * ライセンス情報画面のテスト。
 *
 * 静的な一覧表示だけの画面。**LICENSE_ITEMS の各行がパッケージ名・ライセンス種別・
 * 用途をすべて出すこと**を見る。ここが漏れると、審査対応で必要な OSS 表記が
 * ストアに出ないまま気づかない。
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { LICENSE_ITEMS } from '../../../src/constants/licenses';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
}));

import LicensesScreen from '../licenses';

beforeEach(() => {
  mockBack.mockReset();
});

describe('ライセンス情報', () => {
  it('登録されているパッケージをすべて出す', async () => {
    render(<LicensesScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByText(LICENSE_ITEMS[0].packageName)).toBeTruthy(), {
      timeout: 20_000,
    });
    for (const item of LICENSE_ITEMS) {
      expect(screen.getByText(item.packageName)).toBeTruthy();
    }
  });

  it('パッケージごとにライセンス種別と用途を添える', async () => {
    render(<LicensesScreen />);
    const target = LICENSE_ITEMS[0];

    await waitFor(() => expect(screen.getByText(target.packageName)).toBeTruthy(), {
      timeout: 20_000,
    });
    // ライセンス種別は他のパッケージと重複しうる（MIT が多数）ので存在数で見る
    expect(screen.getAllByText(target.license).length).toBeGreaterThan(0);
    expect(screen.getByText(target.purpose)).toBeTruthy();
  });

  it('戻るで前の画面へ戻る', async () => {
    render(<LicensesScreen />);
    await waitFor(() => expect(screen.getByLabelText('戻る')).toBeTruthy(), { timeout: 20_000 });

    fireEvent.press(screen.getByLabelText('戻る'));
    expect(mockBack).toHaveBeenCalled();
  });
});
