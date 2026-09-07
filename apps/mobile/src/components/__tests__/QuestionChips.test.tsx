/**
 * 質問チップ（R15 / WBS 4.14・#138）。
 * 見るのは「押したら親へその文が渡ること」と「0 件なら何も描かないこと」。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { QuestionChips } from '../QuestionChips';

describe('QuestionChips', () => {
  it('チップを押すと、その文言を親へ渡す', () => {
    const onSelect = jest.fn();
    render(
      <QuestionChips chips={['うどんこ病かもしれません', '実がつかない']} onSelect={onSelect} />,
    );

    fireEvent.press(screen.getByLabelText('うどんこ病かもしれませんを相談文に入れる'));

    expect(onSelect).toHaveBeenCalledWith('うどんこ病かもしれません');
  });

  it('チップが無ければ見出しごと出さない', () => {
    render(<QuestionChips chips={[]} onSelect={jest.fn()} />);

    expect(screen.queryByText('よくある相談から選ぶ')).toBeNull();
  });
});
