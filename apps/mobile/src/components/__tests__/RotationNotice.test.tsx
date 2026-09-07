/**
 * 連作の注意書きの表示テスト（R17 / WBS 4.5）。
 * 見るのは**出るか出ないか**と、履歴が複数あるときの畳み方。
 * 文面そのものは rotation.service の describeRotationWarning が持つ。
 */
import { render, screen } from '@testing-library/react-native';

import { RotationNotice } from '../RotationNotice';
import type { RotationWarning } from '../../services/rotation.service';

function entry(cropName: string, yearsAgo: number, growing = false) {
  return {
    plantingId: `p-${cropName}`,
    cropName,
    plantedOn: '2025-05-01T00:00:00.000Z',
    endedAt: growing ? null : '2025-10-01T00:00:00.000Z',
    growing,
    yearsAgo,
  };
}

function warning(overrides: Partial<RotationWarning> = {}): RotationWarning {
  return {
    cropName: 'トマト',
    family: 'ナス科',
    rotationYears: 4,
    placeName: '南の畝',
    history: [entry('ナス', 1)],
    ...overrides,
  };
}

describe('RotationNotice', () => {
  it('警告が無ければ何も描かない', () => {
    render(<RotationNotice warning={null} />);

    expect(screen.queryByTestId('rotation-notice')).toBeNull();
  });

  it('直近の1件を名指しし、あける年数の目安を添える', () => {
    render(<RotationNotice warning={warning()} />);

    expect(screen.getByTestId('rotation-notice')).toBeTruthy();
    expect(
      screen.getByText('南の畝では去年ナス（ナス科）を育てました。トマトは4年あけるのが目安です。'),
    ).toBeTruthy();
  });

  it('このまま登録できることを必ず伝える（保存を止めない）', () => {
    render(<RotationNotice warning={warning()} />);

    expect(screen.getByText(/このまま登録できます/)).toBeTruthy();
  });

  it('履歴が複数あれば2件目以降を1行にまとめる', () => {
    render(
      <RotationNotice
        warning={warning({
          history: [entry('トウガラシ', 0, true), entry('ジャガイモ', 1), entry('ピーマン', 2)],
        })}
      />,
    );

    expect(screen.getByText('ほかにも 去年 ジャガイモ、2年前 ピーマン')).toBeTruthy();
  });

  it('履歴が1件だけなら「ほかにも」の行を出さない', () => {
    render(<RotationNotice warning={warning()} />);

    expect(screen.queryByText(/ほかにも/)).toBeNull();
  });
});
