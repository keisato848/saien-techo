/**
 * 収穫カードの共有画面（R28 / WBS 4.10 / #41）。
 *
 * 共有は取り消せない**外向きの操作**なので、ここで固定するのは次の 3 点。
 *
 * 1. 画面を開いただけでは共有シートが開かないこと
 * 2. どのボタンがサービスへ何を渡すか（写真つき／ことばだけ）
 * 3. 出せなかったとき（写真が無い・書き出しに失敗した・例外）に**黙らない**こと
 *
 * 何を外へ出すかの判断そのものは harvest-share.service.test が担保している。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import type { HarvestShareCard } from '../../../../src/services/harvest-share.service';

const mockBack = jest.fn();
const mockRouter = { back: mockBack, push: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockParams,
}));

const mockGetHarvestShareCard = jest.fn();
const mockShareHarvestCard = jest.fn();
jest.mock('../../../../src/services/harvest-share.service', () => ({
  ...jest.requireActual('../../../../src/services/harvest-share.service'),
  getHarvestShareCard: (...args: unknown[]) => mockGetHarvestShareCard(...args),
  shareHarvestCard: (...args: unknown[]) => mockShareHarvestCard(...args),
}));

import ShareHarvestScreen from '../[id]/harvests/share';

function card(overrides: Partial<HarvestShareCard> = {}): HarvestShareCard {
  return {
    harvestId: 'h1',
    plantingId: 'p1',
    cropName: 'キュウリ',
    variety: null,
    harvestedAt: '2026-09-07T02:00:00.000Z',
    quantity: 3,
    unit: 'piece',
    photoUri: 'file:///documents/garden-photos/a.jpg',
    photoCount: 1,
    ...overrides,
  };
}

beforeEach(() => {
  mockBack.mockReset();
  mockRouter.push.mockReset();
  mockParams = { id: 'p1', harvestId: 'h1' };
  mockGetHarvestShareCard.mockReset().mockResolvedValue(card());
  mockShareHarvestCard.mockReset().mockResolvedValue('photo');
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('収穫を共有', () => {
  it('共有するカードとことばを、押す前に見せる', async () => {
    render(<ShareHarvestScreen />);

    // このファイルで最初に render する 1 本。モジュール読み込みを丸ごと背負う
    await waitFor(() => expect(screen.getByTestId('harvest-share-card')).toBeTruthy(), {
      timeout: 20_000,
    });
    expect(screen.getByText('キュウリ')).toBeTruthy();
    expect(screen.getByText('3個')).toBeTruthy();
    expect(screen.getByText(/キュウリ 3個 収穫しました/)).toBeTruthy();
    expect(screen.getByText(/位置情報を消してから/)).toBeTruthy();
  });

  // 既定で共有しない（外向きの操作は利用者が押したときだけ）
  it('開いただけでは共有シートを開かない', async () => {
    render(<ShareHarvestScreen />);

    await waitFor(() => expect(screen.getByTestId('harvest-share-card')).toBeTruthy());
    expect(mockShareHarvestCard).not.toHaveBeenCalled();
  });

  it('「写真を共有」は写真つきでサービスへ渡す', async () => {
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('写真を共有')).toBeTruthy());

    fireEvent.press(screen.getByText('写真を共有'));

    await waitFor(() =>
      expect(mockShareHarvestCard).toHaveBeenCalledWith(
        expect.objectContaining({
          harvestId: 'h1',
          photoUri: 'file:///documents/garden-photos/a.jpg',
        }),
        { textOnly: false },
      ),
    );
  });

  it('「ことばだけ共有」は textOnly で渡す', async () => {
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('ことばだけ共有')).toBeTruthy());

    fireEvent.press(screen.getByText('ことばだけ共有'));

    await waitFor(() =>
      expect(mockShareHarvestCard).toHaveBeenCalledWith(expect.anything(), { textOnly: true }),
    );
  });

  // 写真は任意（R06）。写真の無い収穫でも「採れた」を送れる
  it('写真の無い収穫では「ことばだけ共有」だけ出す', async () => {
    mockGetHarvestShareCard.mockResolvedValue(card({ photoUri: null, photoCount: 0 }));
    render(<ShareHarvestScreen />);

    await waitFor(() => expect(screen.getByText('ことばだけ共有')).toBeTruthy());
    expect(screen.queryByText('写真を共有')).toBeNull();
    expect(screen.getByText(/写真がないので/)).toBeTruthy();
  });

  it('写真が複数あるときは 1 枚目だけと伝える', async () => {
    mockGetHarvestShareCard.mockResolvedValue(card({ photoCount: 3 }));
    render(<ShareHarvestScreen />);

    await waitFor(() => expect(screen.getByText(/1 枚目だけ/)).toBeTruthy());
  });

  /**
   * 写真を渡したつもりで渡っていない状態を黙って通さない。
   * サービスは安全側に倒して「ことば」へ落ちるので、落ちたことを画面が伝える。
   */
  it('写真を出せずことばへ落ちたら知らせる', async () => {
    mockShareHarvestCard.mockResolvedValue('text');
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('写真を共有')).toBeTruthy());

    fireEvent.press(screen.getByText('写真を共有'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '写真は共有できませんでした',
        expect.stringContaining('ことばだけ'),
      ),
    );
  });

  // ことばだけを選んだ結果の 'text' は想定どおり。警告を出さない
  it('ことばだけ選んだときは知らせない', async () => {
    mockShareHarvestCard.mockResolvedValue('text');
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('ことばだけ共有')).toBeTruthy());

    fireEvent.press(screen.getByText('ことばだけ共有'));

    await waitFor(() => expect(mockShareHarvestCard).toHaveBeenCalled());
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('共有に失敗したら理由を出す', async () => {
    mockShareHarvestCard.mockRejectedValue(new Error('共有シートを開けませんでした'));
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('写真を共有')).toBeTruthy());

    fireEvent.press(screen.getByText('写真を共有'));

    await waitFor(() =>
      expect(Alert.alert).toHaveBeenCalledWith(
        '共有できませんでした',
        '共有シートを開けませんでした',
      ),
    );
  });

  /**
   * DB に写真の行があってもファイルが消えていることがある（成長記録と同じ事情）。
   * 開けない写真を共有シートへ渡すと、送り先で初めて壊れていると分かる。
   */
  it('写真のファイルが無いときは共有から外し、ことばへ切り替える', async () => {
    render(<ShareHarvestScreen />);
    await waitFor(() => expect(screen.getByText('写真を共有')).toBeTruthy());

    fireEvent(screen.getByLabelText('キュウリの収穫写真'), 'error');

    await waitFor(() => expect(screen.queryByText('写真を共有')).toBeNull());
    expect(screen.getByText(/端末で見つかりませんでした/)).toBeTruthy();

    fireEvent.press(screen.getByText('ことばだけ共有'));
    await waitFor(() =>
      expect(mockShareHarvestCard).toHaveBeenCalledWith(
        expect.objectContaining({ photoUri: null }),
        { textOnly: true },
      ),
    );
  });

  it('見つからない収穫は空状態を出し、戻れる', async () => {
    mockGetHarvestShareCard.mockResolvedValue(null);
    render(<ShareHarvestScreen />);

    await waitFor(() => expect(screen.getByText('この収穫は見つかりませんでした')).toBeTruthy());
    expect(mockShareHarvestCard).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('戻る'));
    expect(mockBack).toHaveBeenCalled();
  });
});
