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

// 連作チェック（R17）はフォームの入力が変わるたびに走る。ここでは
// 「どんな引数で引いたか」と「返ってきた警告をどう出すか」だけを見たいので
// 判定そのものは rotation.service のテストに任せる（文言の関数は実物を使う）
const mockCheckRotation = jest.fn<Promise<unknown>, unknown[]>(() => Promise.resolve(null));
jest.mock('../../services/rotation.service', () => ({
  ...jest.requireActual('../../services/rotation.service'),
  checkRotation: (...args: unknown[]) => mockCheckRotation(...args),
}));

// 作物名の候補（レビュー 41）。**照合そのものは実物を使う** — 前方一致や
// 「どちらですか」の判定を作り物に差し替えると、サービスと画面がずれても気づけない。
// DB を読む getCropMaster だけ差し替える
const mockGetCropMaster = jest.fn<Promise<unknown[]>, []>(() =>
  Promise.resolve([
    { id: 'crop-tomato', name: 'トマト', nameReading: 'とまと' },
    { id: 'crop-naganegi', name: '長ネギ', nameReading: 'ながねぎ' },
    { id: 'crop-hanegi', name: '葉ネギ', nameReading: 'はねぎ' },
  ]),
);
jest.mock('../../services/crop-match.service', () => ({
  ...jest.requireActual('../../services/crop-match.service'),
  getCropMaster: () => mockGetCropMaster(),
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
    mockCheckRotation.mockReset().mockResolvedValue(null);
    mockGetCropMaster.mockReset().mockResolvedValue([
      { id: 'crop-tomato', name: 'トマト', nameReading: 'とまと' },
      { id: 'crop-naganegi', name: '長ネギ', nameReading: 'ながねぎ' },
      { id: 'crop-hanegi', name: '葉ネギ', nameReading: 'はねぎ' },
    ]);
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

// ─── 連作障害チェック（R17 / WBS 4.5）───────────────────────────────────
describe('PlantingForm の連作チェック', () => {
  const warning = {
    cropName: 'トマト',
    family: 'ナス科',
    rotationYears: 4,
    placeName: '南の畝',
    history: [
      {
        plantingId: 'p-nasu',
        cropName: 'ナス',
        plantedOn: '2025-05-01T00:00:00.000Z',
        endedAt: '2025-10-01T00:00:00.000Z',
        growing: false,
        yearsAgo: 1,
      },
    ],
  };

  beforeEach(() => {
    mockPush.mockReset();
    mockPlaces.mockReset().mockResolvedValue([]);
    mockTags.mockReset().mockResolvedValue([]);
    mockCheckRotation.mockReset().mockResolvedValue(null);
    mockGetCropMaster.mockReset().mockResolvedValue([]);
  });

  it('作物名・場所・植え付け日を渡して引く。編集時は自分自身を除く', async () => {
    mockPlaces.mockResolvedValue([{ id: 'place-1', name: '南の畝', kind: 'row' }]);
    setup({ plantingId: 'p-me', initialValues: { cropName: 'トマト' } });

    await waitFor(() => expect(screen.getByText('南の畝')).toBeTruthy());
    fireEvent.press(screen.getByText('南の畝'));

    await waitFor(
      () =>
        expect(mockCheckRotation).toHaveBeenCalledWith(
          expect.objectContaining({
            cropName: 'トマト',
            placeId: 'place-1',
            excludePlantingId: 'p-me',
          }),
        ),
      { timeout: 5000 },
    );
  });

  it('当たれば注意書きを出すが、保存は止めない', async () => {
    mockCheckRotation.mockResolvedValue(warning);
    const { onSubmit } = setup({ initialValues: { cropName: 'トマト' } });

    await waitFor(() => expect(screen.getByTestId('rotation-notice')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(
      screen.getByText('南の畝では去年ナス（ナス科）を育てました。トマトは4年あけるのが目安です。'),
    ).toBeTruthy();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  it('判定に失敗しても注意書きを出さず、入力は続けられる', async () => {
    mockCheckRotation.mockRejectedValue(new Error('DB not ready'));
    const { onSubmit } = setup({ initialValues: { cropName: 'トマト' } });

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('rotation-notice')).toBeNull();
  });
});

// ─── 作物名の候補（レビュー 41 / 7c）─────────────────────────────────────
// cropId が付くかどうかで進行帯・「つぎの作業」・収穫の既定単位が決まる。
// 候補を出して**付く確率を上げる**のがここの仕事
describe('PlantingForm の作物名の候補', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockPlaces.mockReset().mockResolvedValue([]);
    mockTags.mockReset().mockResolvedValue([]);
    mockCheckRotation.mockReset().mockResolvedValue(null);
    mockGetCropMaster.mockReset().mockResolvedValue([
      { id: 'crop-tomato', name: 'トマト', nameReading: 'とまと' },
      { id: 'crop-naganegi', name: '長ネギ', nameReading: 'ながねぎ' },
      { id: 'crop-hanegi', name: '葉ネギ', nameReading: 'はねぎ' },
    ]);
  });

  async function focusCropName(): Promise<void> {
    const input = screen.getByPlaceholderText('トマト');
    fireEvent(input, 'focus');
    await waitFor(() => expect(mockGetCropMaster).toHaveBeenCalled());
  }

  it('作物名にフォーカスするまでマスターを引かない', () => {
    setup();
    expect(mockGetCropMaster).not.toHaveBeenCalled();
  });

  it('マスターは 1 回だけ引く', async () => {
    setup();
    await focusCropName();
    fireEvent(screen.getByPlaceholderText('トマト'), 'focus');
    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'とま');

    await waitFor(() => expect(screen.getByText('もしかして')).toBeTruthy());
    expect(mockGetCropMaster).toHaveBeenCalledTimes(1);
  });

  it('1 文字では候補を出さない', async () => {
    setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'と');

    await waitFor(() => expect(screen.queryByTestId('crop-suggestions')).toBeNull());
  });

  it('2 文字以上で候補を出し、押すと名前と読みの両方が入る', async () => {
    const { onSubmit } = setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'とま');
    await waitFor(() => expect(screen.getByText('もしかして')).toBeTruthy());

    fireEvent.press(screen.getByLabelText('作物名をトマトにする'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    // 読みまで入れるのは FTS のため。名前だけ入れると検索でかなに当たらない
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cropName: 'トマト',
      cropNameReading: 'とまと',
    });
  });

  it('「ネギ」はどちらか選ばせる（葉ネギに黙って寄せない）', async () => {
    const { onSubmit } = setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ネギ');
    await waitFor(() => expect(screen.getByText('どちらですか')).toBeTruthy());
    expect(screen.getByLabelText('作物名を長ネギにする')).toBeTruthy();
    expect(screen.getByLabelText('作物名を葉ネギにする')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('作物名を長ネギにする'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      cropName: '長ネギ',
      cropNameReading: 'ながねぎ',
    });
  });

  it('候補を押したあと名前を打ち直したら、読みを持ち越さない', async () => {
    const { onSubmit } = setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'とま');
    await waitFor(() => expect(screen.getByText('もしかして')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('作物名をトマトにする'));

    // 「ナス」なのに読みが「とまと」の行ができると、検索が別の作物に当たる
    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'ナス');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].cropName).toBe('ナス');
    expect(onSubmit.mock.calls[0][0].cropNameReading).toBeUndefined();
  });

  it('当たらなければ候補を出さない（自由入力を禁じない）', async () => {
    const { onSubmit } = setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'パクチー');
    await waitFor(() => expect(screen.queryByTestId('crop-suggestions')).toBeNull());

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].cropName).toBe('パクチー');
  });

  it('マスターが引けなくても入力と保存は続けられる', async () => {
    mockGetCropMaster.mockRejectedValue(new Error('DB not ready'));
    const { onSubmit } = setup();
    await focusCropName();

    fireEvent.changeText(screen.getByPlaceholderText('トマト'), 'とま');
    await waitFor(() => expect(screen.queryByText('もしかして')).toBeNull());

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});
