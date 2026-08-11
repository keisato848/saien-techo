/**
 * ホームの構成（S01 / WBS 3.5 ホーム統合）。
 *
 * 各カードの中身はそれぞれのテストで担保。ここで見るのは**統合の判断**:
 * カードの並びと、栽培ゼロのときに何を出すか。
 * 並びは「予定 → 提案 → 自分の畑 → 季節 → 履歴」（docs/画面設計.md S01）。
 */
import { render, screen, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockGetTimeline = jest.fn();
jest.mock('../../../src/services/garden-timeline.service', () => ({
  ...jest.requireActual('../../../src/services/garden-timeline.service'),
  getTimeline: (...args: unknown[]) => mockGetTimeline(...args),
}));

const mockGetPlantingList = jest.fn();
jest.mock('../../../src/services/planting.service', () => ({
  ...jest.requireActual('../../../src/services/planting.service'),
  getPlantingList: (...args: unknown[]) => mockGetPlantingList(...args),
}));

// 子カードは印だけ出す。中身ではなく「どこに置いたか」を見たいので
function mockMarkerCard(label: string) {
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createElement } = require('react');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Text } = require('react-native');
    return createElement(Text, null, label);
  };
}

jest.mock('../../../src/components/TodayReminderCard', () => ({
  TodayReminderCard: mockMarkerCard('＝今日のリマインダー＝'),
}));
jest.mock('../../../src/components/NextActionCard', () => ({
  NextActionCard: mockMarkerCard('＝つぎの作業＝'),
}));
jest.mock('../../../src/components/MonthlyWorkCard', () => ({
  MonthlyWorkCard: mockMarkerCard('＝今月の菜園仕事＝'),
}));

import HomeScreen from '../index';

/** 描画結果に現れる文字列を、画面上の順に並べて返す */
function renderedTexts(): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node && typeof node === 'object' && 'children' in node) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(screen.toJSON());
  return found;
}

function orderOf(...labels: string[]): number[] {
  const texts = renderedTexts();
  return labels.map((label) => texts.findIndex((text) => text.includes(label)));
}

function planting(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    cropName: 'トマト',
    variety: null,
    placeName: null,
    plantedOn: '2026-07-01',
    elapsedDays: 40,
    coverPhotoUri: null,
    endedAt: null,
    tags: [],
    ...overrides,
  };
}

describe('ホーム（S01 / WBS 3.5）', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetTimeline.mockReset().mockResolvedValue([]);
    mockGetPlantingList.mockReset().mockResolvedValue([]);
  });

  describe('カードの並び', () => {
    beforeEach(() => {
      mockGetPlantingList.mockResolvedValue([planting()]);
    });

    it('予定 → 提案 → 自分の畑 → 季節 → 履歴 の順に並べる', async () => {
      render(<HomeScreen />);
      await waitFor(() => expect(screen.getByText('育てているもの')).toBeTruthy());

      const positions = orderOf(
        '今日のリマインダー',
        'つぎの作業',
        '育てているもの',
        '今月の菜園仕事',
        'さいきんの記録',
      );

      expect(positions.every((index) => index >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    });

    it('自分で決めた予定を、アプリの提案より上に置く', async () => {
      render(<HomeScreen />);
      await waitFor(() => expect(screen.getByText('育てているもの')).toBeTruthy());

      const [reminder, nextAction] = orderOf('今日のリマインダー', 'つぎの作業');
      expect(reminder).toBeLessThan(nextAction);
    });
  });

  describe('栽培ゼロの空状態', () => {
    it('ようこそを出す', async () => {
      render(<HomeScreen />);
      await waitFor(() => expect(screen.getByText('さいえん手帳へようこそ')).toBeTruthy());
    });

    // まだ何も植えていない人に「今月なにを植えられるか」が一番の手がかりになる。
    // ここを空にすると、登録するまで何も分からない行き止まりになる（WBS 3.5）
    it('「今月の菜園仕事」も出す（行き止まりにしない）', async () => {
      render(<HomeScreen />);
      await waitFor(() => expect(screen.getByText('さいえん手帳へようこそ')).toBeTruthy());

      expect(screen.getByText('＝今月の菜園仕事＝')).toBeTruthy();
    });

    it('タイムラインは出さない', async () => {
      render(<HomeScreen />);
      await waitFor(() => expect(screen.getByText('さいえん手帳へようこそ')).toBeTruthy());

      expect(screen.queryByText('さいきんの記録')).toBeNull();
    });
  });

  describe('栽培はあるが記録が無いとき', () => {
    it('ようこそではなく、記録の付け方を案内する', async () => {
      mockGetPlantingList.mockResolvedValue([planting()]);
      render(<HomeScreen />);

      await waitFor(() => expect(screen.getByText('さいきんの記録')).toBeTruthy());
      expect(screen.queryByText('さいえん手帳へようこそ')).toBeNull();
      expect(screen.getByText(/まだ作業の記録がありません/)).toBeTruthy();
    });
  });
});
