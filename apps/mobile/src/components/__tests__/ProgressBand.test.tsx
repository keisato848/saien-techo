/**
 * 進行帯の読み上げ（2026-09-07 レビュー 36）。
 *
 * 帯は Svg だけで描いており、a11y 属性が 1 つも無いと
 * **収穫の窓も作業ログも今日の位置も読み上げに存在しない**。
 * ここで固定するのは「帯 1 枚が progressbar として読める」ことだけで、
 * 文言そのものは growth-progress.service の describeProgressForA11y が持つ。
 */
import { render, screen } from '@testing-library/react-native';

import { ProgressBand } from '../ProgressBand';
import type { PlantingProgress } from '../../services/growth-progress.service';

function progress(overrides: Partial<PlantingProgress> = {}): PlantingProgress {
  return {
    plantingId: 'planting-1',
    state: 'growing',
    harvestCount: 0,
    elapsedDays: 45,
    harvestAfterDays: 70,
    harvestWindow: { min: 60, max: 70 },
    ratio: 45 / 70,
    daysToHarvest: 15,
    logDays: [5, 20, 35],
    ...overrides,
  };
}

describe('ProgressBand の読み上げ', () => {
  it('progressbar として読め、進み具合を 0〜100 で持つ', () => {
    render(<ProgressBand progress={progress()} width={70} />);

    const band = screen.getByTestId('progress-band');
    expect(band.props.accessibilityRole).toBe('progressbar');
    expect(band.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 64 });
  });

  it('ラベルに収穫の窓と作業ログの件数が入る', () => {
    render(<ProgressBand progress={progress()} width={70} />);

    const label = screen.getByTestId('progress-band').props.accessibilityLabel;
    expect(label).toContain('60日〜70日');
    expect(label).toContain('作業の記録3件');
  });

  it('採りどきはラベルでも採りどきと読む', () => {
    render(
      <ProgressBand
        progress={progress({ state: 'due', daysToHarvest: -8, ratio: 1 })}
        width={70}
      />,
    );

    expect(screen.getByTestId('progress-band').props.accessibilityLabel).toContain('採りどき');
    expect(screen.getByTestId('progress-band').props.accessibilityValue.now).toBe(100);
  });

  it('目安が無ければ帯を描かないので読み上げにも出さない', () => {
    render(<ProgressBand progress={progress({ state: 'none', ratio: null })} width={70} />);

    expect(screen.queryByTestId('progress-band')).toBeNull();
  });
});
