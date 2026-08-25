/**
 * 成長記録の画面（R16 / WBS 4.4）。
 *
 * 画面テストで見張るのは分岐:
 * - 既定は「いちばん古い × いちばん新しい」で、間隔を日数で出す
 * - 選び直しは**いま選んでいる側**にだけ効く
 * - **ファイルが消えている写真**は空白ではなく「見つかりません」に落ち、
 *   生きている写真へ差し替わる（ユーザーが選び直せる）
 * - 使える写真が 2 枚未満なら成長記録自体をたたむ
 */
import { configure, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { useEffect as reactUseEffect } from 'react';

// 既定の 1 秒だと、最初のテストがモジュール初期化のぶんで落ちることがある
// （add.test.tsx と同じ負荷依存の揺れ）
configure({ asyncUtilTimeout: 10_000 });

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: 'planting-1' }),
  useFocusEffect: (cb: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = jest.requireActual('react') as { useEffect: typeof reactUseEffect };
    useEffect(() => {
      cb();
    }, [cb]);
  },
}));

const mockGetGrowthPhotos = jest.fn();
jest.mock('../../../../src/services/growth-compare.service', () => ({
  MIN_COMPARE_PHOTOS: 2,
  getGrowthPhotos: (...args: unknown[]) => mockGetGrowthPhotos(...args),
  daysBetween: (a: { elapsedDays: number }, b: { elapsedDays: number }) =>
    Math.abs(b.elapsedDays - a.elapsedDays),
}));

import CompareScreen from '../[id]/compare';

function photo(index: number, elapsedDays: number) {
  return {
    uri: `file:///documents/garden-photos/p${index}.jpg`,
    loggedAt: `2026-05-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
    elapsedDays,
    source: 'care_log' as const,
    index,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('既定で最古と最新を並べ、間隔を日数で出す', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10), photo(1, 30), photo(2, 50)]);

  render(<CompareScreen />);

  await waitFor(() => expect(screen.getByText('10 日目')).toBeTruthy());
  expect(screen.getByText('50 日目')).toBeTruthy();
  expect(screen.getByText('この間 40 日')).toBeTruthy();
});

it('選び直しは、いま選んでいる側にだけ効く', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10), photo(1, 30), photo(2, 50)]);

  render(<CompareScreen />);
  await waitFor(() => expect(screen.getByText('10 日目')).toBeTruthy());

  // 既定は右側が対象。30 日目を選ぶと右だけが入れ替わる
  fireEvent.press(screen.getByLabelText('30日目を選ぶ'));
  await waitFor(() => expect(screen.getByText('30 日目')).toBeTruthy());
  expect(screen.getByText('10 日目')).toBeTruthy();
  expect(screen.getByText('この間 20 日')).toBeTruthy();

  // 左に切り替えてから選ぶと、今度は左が入れ替わる
  fireEvent.press(screen.getByLabelText('左の写真を選ぶ'));
  fireEvent.press(screen.getByLabelText('50日目を選ぶ'));
  await waitFor(() => expect(screen.getByText('50 日目')).toBeTruthy());
  expect(screen.getByText('この間 20 日')).toBeTruthy();
});

it('ファイルが消えている写真は「見つかりません」に落ち、生きている写真へ差し替わる', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10), photo(1, 30), photo(2, 50)]);

  render(<CompareScreen />);
  await waitFor(() => expect(screen.getByText('50 日目')).toBeTruthy());

  // 右（50 日目）の読み込みが失敗した
  fireEvent(screen.getByLabelText('50日目の写真'), 'error');

  // 空白のままにせず、残っている 30 日目へ差し替える
  await waitFor(() => expect(screen.getByText('30 日目')).toBeTruthy());
  expect(screen.queryByText('50 日目')).toBeNull();
});

it('使える写真が 2 枚未満なら成長記録をたたむ', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10)]);

  render(<CompareScreen />);

  await waitFor(() =>
    expect(screen.getByText(/成長記録には、この栽培の写真が 2 枚以上必要です/)).toBeTruthy(),
  );
});

it('写真が 1 枚も無いときも行き止まりの空白にしない', async () => {
  mockGetGrowthPhotos.mockResolvedValue([]);

  render(<CompareScreen />);

  await waitFor(() =>
    expect(screen.getByText(/作業ログや収穫に写真を足すと、ここに並びます/)).toBeTruthy(),
  );
});

it('左右が同時に失敗しても、同じ写真を 2 枚並べない', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10), photo(1, 30), photo(2, 50)]);

  render(<CompareScreen />);
  await waitFor(() => expect(screen.getByText('10 日目')).toBeTruthy());

  fireEvent(screen.getByLabelText('10日目の写真'), 'error');
  fireEvent(screen.getByLabelText('50日目の写真'), 'error');

  // 残るのは 30 日目 1 枚だけ。両側に同じものを入れず、成長記録をたたむ
  await waitFor(() =>
    expect(screen.getByText(/成長記録には、この栽培の写真が 2 枚以上必要です/)).toBeTruthy(),
  );
});

it('反対側と同じ写真を選んだら入れ替える（同じ 2 枚を並べない）', async () => {
  mockGetGrowthPhotos.mockResolvedValue([photo(0, 10), photo(1, 30), photo(2, 50)]);

  render(<CompareScreen />);
  await waitFor(() => expect(screen.getByText('10 日目')).toBeTruthy());

  // 右が対象のまま、左と同じ 10 日目を選ぶ → 左右が入れ替わる
  fireEvent.press(screen.getByLabelText('10日目を選ぶ'));

  await waitFor(() => expect(screen.getByText('10 日目')).toBeTruthy());
  expect(screen.getByText('50 日目')).toBeTruthy();
  expect(screen.getByText('この間 40 日')).toBeTruthy();
});
