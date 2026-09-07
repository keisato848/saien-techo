/**
 * 初回利用ガイドの吹き出し（WBS 2.7・テスト整備は WBS T1）。
 *
 * 守りたいのは **終わり方**。最後の 1 枚で「スキップ」が残っていると、
 * 押した人は「読み終えた」のに途中で降りたことになる（次に開いたときの扱いは同じでも、
 * 押す側は迷う）。逆に最後まで「次へ」のままだと、押しても閉じないように見える。
 * どちらも実装のうっかりで起きるうえ、絵としては正しく見えてしまう。
 *
 * 暗幕のくり抜き位置は座標の計算そのもので、実機でしか正しさを判定できないため触らない。
 * 「対象を測れなかったときに案内が消えない」ことだけ押さえる。
 */
import { fireEvent, render, screen } from '@testing-library/react-native';

import { CoachMarkOverlay, type CoachMarkStep } from '../CoachMarkOverlay';

function step(overrides: Partial<CoachMarkStep> = {}): CoachMarkStep {
  return {
    key: 'backup',
    title: 'データを守る',
    text: '「バックアップ・復元」でファイルに書き出せます。',
    rect: { x: 20, y: 100, width: 300, height: 60 },
    ...overrides,
  };
}

function setup(props: Partial<React.ComponentProps<typeof CoachMarkOverlay>> = {}) {
  const onNext = jest.fn();
  const onSkip = jest.fn();
  render(
    <CoachMarkOverlay
      visible
      step={step()}
      index={0}
      total={3}
      onNext={onNext}
      onSkip={onSkip}
      {...props}
    />,
  );
  return { onNext, onSkip };
}

describe('CoachMarkOverlay', () => {
  it('表示しない指定なら何も出さない', () => {
    setup({ visible: false });

    expect(screen.queryByText('データを守る')).toBeNull();
  });

  // 測定前は step が null。ここで空の吹き出しを出すと一瞬だけ枠が光る
  it('見せるステップが無ければ何も出さない', () => {
    setup({ step: null });

    expect(screen.queryByText('次へ')).toBeNull();
  });

  it('見出し・本文と、何枚目かを出す', () => {
    setup({ index: 1, total: 3 });

    expect(screen.getByText('データを守る')).toBeTruthy();
    expect(screen.getByText('「バックアップ・復元」でファイルに書き出せます。')).toBeTruthy();
    expect(screen.getByText('2 / 3')).toBeTruthy();
  });

  it('途中のステップは「次へ」と「スキップ」を両方出す', () => {
    const { onNext, onSkip } = setup({ index: 0, total: 3 });

    fireEvent.press(screen.getByText('次へ'));
    expect(onNext).toHaveBeenCalled();

    fireEvent.press(screen.getByText('スキップ'));
    expect(onSkip).toHaveBeenCalled();
  });

  // 最後の 1 枚で降りる導線を残すと、読み終えた人にも「途中でやめる」を選ばせてしまう
  it('最後のステップは「はじめる」だけにし、スキップを出さない', () => {
    const { onNext } = setup({ index: 2, total: 3 });

    expect(screen.queryByText('次へ')).toBeNull();
    expect(screen.queryByText('スキップ')).toBeNull();

    fireEvent.press(screen.getByText('はじめる'));
    expect(onNext).toHaveBeenCalled();
  });

  it('1 枚しかないガイドは、最初から「はじめる」', () => {
    setup({ index: 0, total: 1 });

    expect(screen.getByText('1 / 1')).toBeTruthy();
    expect(screen.getByText('はじめる')).toBeTruthy();
    expect(screen.queryByText('スキップ')).toBeNull();
  });

  // 条件つきの UI は測れないことがある。そこで案内ごと消えると説明が欠ける
  it('対象を測れなかったステップでも案内は出す', () => {
    setup({ step: step({ key: 'guide', title: '使い方ガイド', rect: null }) });

    expect(screen.getByText('使い方ガイド')).toBeTruthy();
    expect(screen.getByLabelText('次のガイドへ')).toBeTruthy();
  });
});
