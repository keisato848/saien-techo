import { act, render, screen } from '@testing-library/react-native';
import React from 'react';

import { Toast } from '../Toast';

describe('Toast', () => {
  it('visible=true のときメッセージを表示する', () => {
    render(<Toast message="保存しました" visible={true} onDismiss={jest.fn()} />);
    expect(screen.getByText('保存しました')).toBeTruthy();
  });

  it('visible=false のとき何も表示しない', () => {
    render(<Toast message="保存しました" visible={false} onDismiss={jest.fn()} />);
    expect(screen.queryByText('保存しました')).toBeNull();
  });

  it('duration 後に onDismiss が呼ばれる', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="完了" visible={true} onDismiss={onDismiss} duration={100} />);
    // Animated.sequence: fade-in(200ms) + delay(duration) + fade-out(200ms)
    // duration=100 なので合計 400ms を超えるまで進める
    act(() => jest.advanceTimersByTime(600));
    // Animated が useNativeDriver でも JS タイマーにフォールバックするため呼ばれる
    expect(onDismiss).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('visible=false の場合は onDismiss が呼ばれない', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    render(<Toast message="完了" visible={false} onDismiss={onDismiss} />);
    act(() => jest.advanceTimersByTime(5000));
    expect(onDismiss).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  /**
   * 回帰: #92「バックアップ復元の完了トーストが表示されない」
   *
   * アニメーションが**中断**されたときに onDismiss を呼ばないことを見る。
   * 以前は `start(cb)` の `finished` を見ておらず、中断でも cb が走っていた。
   * 親の再描画で effect が作り直されるたびにこれが起き、トーストが即消えしていた。
   *
   * アンマウントで検証するのは、**jest の Animated モックが時間を忠実に再現しない**ため
   * （duration=1000 でも 1100ms 前に完了する）。時間に依存する検証は当てにならないので、
   * 中断を確実に起こせるアンマウントで `finished` ガードだけを見る。
   *
   * **親の再描画による中断は jest では再現しない。** 実機・エミュレータで確認すること
   * （backup.tsx の復元 → トーストが 2 秒表示される）。
   */
  it('表示中にアンマウントされても onDismiss を呼ばない（#92 の finished ガード）', () => {
    jest.useFakeTimers();
    const onDismiss = jest.fn();
    const { unmount } = render(
      <Toast message="復元しました" visible={true} onDismiss={onDismiss} duration={2000} />,
    );

    unmount(); // cleanup で animation.stop() → コールバックは finished:false で来る
    act(() => jest.advanceTimersByTime(5000));

    expect(onDismiss).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('onDismiss の identity が変わっても最新の関数を呼ぶ（ref 経由の確認）', () => {
    jest.useFakeTimers();
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = render(
      <Toast message="完了" visible={true} onDismiss={first} duration={100} />,
    );

    rerender(<Toast message="完了" visible={true} onDismiss={second} duration={100} />);
    act(() => jest.advanceTimersByTime(1000));

    // ref で最新を参照しているので、差し替え後の関数が呼ばれる
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
