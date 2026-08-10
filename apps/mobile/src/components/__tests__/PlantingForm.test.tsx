import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { PlantingForm } from '../PlantingForm';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn() }),
  // 実装は useFocusEffect で場所とタグを読む。テストでは即時実行でよい
  useFocusEffect: (effect: () => void) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('react').useEffect(effect, [effect]);
  },
}));

const mockPlaces = jest.fn(() => Promise.resolve<{ id: string; name: string; kind: string }[]>([]));
jest.mock('../../services/place.service', () => ({
  getPlaceList: () => mockPlaces(),
}));

const mockTags = jest.fn(() => Promise.resolve<string[]>([]));
// elapsedDaysFrom は実物を使う。日数の数え方をモックで持つと、画面と
// サービスで違う日数になっても気づけない（PR #90 の 33日目/34日 のずれ）
jest.mock('../../services/planting.service', () => ({
  ...jest.requireActual('../../services/planting.service'),
  getPlantingTagNames: () => mockTags(),
}));

jest.mock('../../services/photo-storage.service', () => ({
  persistRecipePhoto: jest.fn(),
}));
jest.mock('../../services/photo-capture.service', () => ({ capturePhoto: jest.fn() }));
jest.mock('../../services/expo-photo-capture.adapter', () => ({
  expoImagePickerPhotoCaptureAdapter: {},
}));

function setup(props: Partial<React.ComponentProps<typeof PlantingForm>> = {}) {
  const onSubmit = jest.fn(() => Promise.resolve());
  const onCancel = jest.fn();
  render(<PlantingForm onSubmit={onSubmit} onCancel={onCancel} title="栽培を追加" {...props} />);
  return { onSubmit, onCancel };
}

describe('PlantingForm', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPlaces.mockReset().mockResolvedValue([]);
    mockTags.mockReset().mockResolvedValue([]);
  });

  it('作物名が空だと保存できず、エラーを出す', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('作物名は必須です')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('作物名だけで保存できる（R01 の最短登録）', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ナス');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ cropName: 'ナス', plantedAs: 'seedling' });
  });

  it('既定は「苗から」', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ナス');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].plantedAs).toBe('seedling');
  });

  it('「種から」に切り替えられる', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'アオジソ');
    fireEvent.press(screen.getByText('種から'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].plantedAs).toBe('seed');
  });

  it('未来の植え付け日は弾く（予定は作付け計画の領分）', async () => {
    const future = new Date();
    future.setDate(future.getDate() + 3);
    const { onSubmit } = setup({
      initialValues: { cropName: 'トマト', plantedOn: future.toISOString() },
    });

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('未来の日付は登録できません')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // すでに育てている株を後から登録する導線（さかのぼり登録）。
  // 既定の「今日」のまま保存されると経過日数がずれ、R10 の「次の作業」
  // （追肥・収穫の目安日数との突き合わせ）まで狂う
  it('さかのぼりのクイック選択で植え付け日を過去にできる', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'トマト');
    fireEvent.press(screen.getByText('1か月前'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    const saved = new Date(onSubmit.mock.calls[0][0].plantedOn);
    const daysAgo = Math.round((Date.now() - saved.getTime()) / 86_400_000);
    expect(daysAgo).toBe(30);
  });

  it('さかのぼると経過日数が出る（チップの文言と一致する）', async () => {
    setup();

    fireEvent.press(screen.getByText('1週間前'));

    // 「1週間前」を押したら 7 日目。ここがずれると一覧・提案文ともずれる
    await waitFor(() => expect(screen.getByText(/今日で 7 日目/)).toBeTruthy());
  });

  it('すでに育てているものも登録できると分かる文言を出す', async () => {
    setup();
    await waitFor(() =>
      expect(screen.getByText(/すでに育てているものは、植えた日にさかのぼれます/)).toBeTruthy(),
    );
  });

  it('編集時は値が埋まっている', async () => {
    setup({
      initialValues: {
        cropName: 'トマト',
        variety: 'アイコ',
        note: '雨よけをつけた',
        tags: ['夏野菜'],
      },
    });

    await waitFor(() => expect(screen.getByDisplayValue('トマト')).toBeTruthy());
    expect(screen.getByDisplayValue('アイコ')).toBeTruthy();
    expect(screen.getByDisplayValue('雨よけをつけた')).toBeTruthy();
  });

  it('場所が未登録なら、その旨を出す', async () => {
    setup();
    await waitFor(() => expect(screen.getByText('登録された場所がありません。')).toBeTruthy());
  });

  it('場所があればチップで選べる', async () => {
    mockPlaces.mockResolvedValue([{ id: 'p1', name: '南の畝', kind: 'row' }]);
    const { onSubmit } = setup();

    await waitFor(() => expect(screen.getByText('南の畝')).toBeTruthy());
    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'トマト');
    fireEvent.press(screen.getByText('南の畝'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].placeId).toBe('p1');
  });

  it('場所チップに種別は併記しない（「南の畝 ・畝」を避ける）', async () => {
    mockPlaces.mockResolvedValue([{ id: 'p1', name: '南の畝', kind: 'row' }]);
    setup();

    await waitFor(() => expect(screen.getByText('南の畝')).toBeTruthy());
    expect(screen.queryByText(/南の畝.*畝/)).toBeNull();
  });

  it('「場所を追加」から場所の登録へ飛べる（登録中に詰まないように）', async () => {
    setup();

    await waitFor(() => expect(screen.getByText('場所を追加')).toBeTruthy());
    fireEvent.press(screen.getByText('場所を追加'));

    expect(mockPush).toHaveBeenCalledWith('/places/new');
  });

  it('タグ候補は栽培に付いているものだけを使う', async () => {
    mockTags.mockResolvedValue(['夏野菜', '実もの']);
    setup();

    await waitFor(() => expect(screen.getByText('夏野菜')).toBeTruthy());
    expect(mockTags).toHaveBeenCalled();
  });

  it('キャンセルで onCancel を呼ぶ', () => {
    const { onCancel } = setup();
    fireEvent.press(screen.getByText('キャンセル'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
