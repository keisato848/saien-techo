/**
 * 場所の登録・編集フォーム（R02 / WBS 1.6・テスト整備は WBS T1）。
 *
 * 画面側（places/new・places/[id]/edit）のテストは「サービスへ何を渡したか」を見るが、
 * **フォームが親へ何を渡すか**はそこからは見えない。既定の種類・チップの選び直し・
 * 空の名前で送らないことは、間違えても「保存できた」ように見えてしまうので、
 * MaterialForm と同じ形でここに置く。
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { PlaceForm } from '../PlaceForm';

const NAME_PLACEHOLDER = '南の畝 / ベランダ プランターA';
const NOTE_PLACEHOLDER = '日当たり良好 / 西日が強い など';

function setup(props: Partial<React.ComponentProps<typeof PlaceForm>> = {}) {
  const onSubmit = jest.fn(() => Promise.resolve());
  const onCancel = jest.fn();
  render(<PlaceForm onSubmit={onSubmit} onCancel={onCancel} title="場所を追加" {...props} />);
  return { onSubmit, onCancel };
}

describe('PlaceForm', () => {
  it('名前が空のままでは保存しない', async () => {
    const { onSubmit } = setup();

    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('名前は必須です')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  // 種類を選ばずに登録できないと、プランターしか無い人にも選択を強いることになる
  it('名前だけで保存でき、既定の種類はプランター', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'ベランダ');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: 'ベランダ', kind: 'planter' });
  });

  it('種類を選び直せる', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText(NAME_PLACEHOLDER), '南の畝');
    fireEvent.press(screen.getByText('畝'));
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].kind).toBe('row');
  });

  it('4 つの種類をすべて選べる', async () => {
    setup();

    for (const label of ['プランター', '畝', '区画', 'その他']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('メモをそのまま渡す', async () => {
    const { onSubmit } = setup();

    fireEvent.changeText(screen.getByPlaceholderText(NAME_PLACEHOLDER), '南の畝');
    fireEvent.changeText(screen.getByPlaceholderText(NOTE_PLACEHOLDER), '西日が強い');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].note).toBe('西日が強い');
  });

  // 編集で初期値が入らないと、開いた瞬間に空のフォームで上書きしてしまう
  it('編集では登録済みの内容が入っている', async () => {
    const { onSubmit } = setup({
      initialValues: { name: '去年の畝', kind: 'plot', note: '粘土質' },
      title: '場所を編集',
    });

    expect(screen.getByDisplayValue('去年の畝')).toBeTruthy();
    expect(screen.getByDisplayValue('粘土質')).toBeTruthy();

    fireEvent.press(screen.getByText('保存'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: '去年の畝', kind: 'plot' });
  });

  it('キャンセルは保存せずに閉じる', () => {
    const { onSubmit, onCancel } = setup();

    fireEvent.press(screen.getByText('キャンセル'));

    expect(onCancel).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('保存ボタンの文言を差し替えられる', () => {
    setup({ submitLabel: '登録' });

    expect(screen.getByText('登録')).toBeTruthy();
    expect(screen.queryByText('保存')).toBeNull();
  });

  // 削除は編集画面だけの操作。footer を渡さない登録画面に出てはいけない
  it('footer は渡されたときだけ出す', () => {
    setup();
    expect(screen.queryByText('この場所を削除')).toBeNull();

    screen.unmount();
    setup({ footer: <Text>この場所を削除</Text> });
    expect(screen.getByText('この場所を削除')).toBeTruthy();
  });

  it('保存中は「保存中」に変わり、続けて押しても二重に送らない', async () => {
    // 保存の途中で止めたいので解決を手元に持つ。放置すると後始末が残る
    let finish: () => void = () => undefined;
    const onSubmit = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const onCancel = jest.fn();
    render(<PlaceForm onSubmit={onSubmit} onCancel={onCancel} title="場所を追加" />);

    fireEvent.changeText(screen.getByPlaceholderText(NAME_PLACEHOLDER), 'ベランダ');
    fireEvent.press(screen.getByText('保存'));

    await waitFor(() => expect(screen.getByText('保存中')).toBeTruthy());
    fireEvent.press(screen.getByText('保存中'));

    expect(onSubmit).toHaveBeenCalledTimes(1);

    finish();
    await waitFor(() => expect(screen.getByText('保存')).toBeTruthy());
  });
});
