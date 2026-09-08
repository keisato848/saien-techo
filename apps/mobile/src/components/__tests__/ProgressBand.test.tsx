/**
 * 進行帯の描画（4.19 レビュー 3）。
 *
 * `testID="progress-band-window"` は 4.19 で置かれていたのに**誰も見ていなかった**ため、
 * 窓が `surfaceInput` に対してコントラスト 1.01 で塗られていること、
 * 角丸で境界が最大 13 日ずれていることに気づけなかった。ここで固定する。
 *
 * 実機でしか出ない見え方（潰れ・はみ出し）はテストの担当外。ここが見るのは
 * **どこに・どの色で・そもそも描くのか**という、数として決まっている部分だけ。
 */
import { render, screen } from '@testing-library/react-native';

import { Colors } from '../../constants/theme';
import type { PlantingProgress } from '../../services/growth-progress.service';
import { ProgressBand } from '../ProgressBand';

const WIDTH = 100;

/**
 * react-native-svg は `fill` を `{ type, payload }` に畳んでから props に載せる。
 * 色の比較は元の 16 進に戻さず、同じ畳み方をした数と突き合わせる
 */
function fillPayload(hex: string): number {
  return (0xff000000 | parseInt(hex.slice(1), 16)) >>> 0;
}

function progress(overrides: Partial<PlantingProgress> = {}): PlantingProgress {
  return {
    plantingId: 'p1',
    state: 'growing',
    harvestCount: 0,
    elapsedDays: 45,
    harvestAfterDays: 60,
    harvestWindow: null,
    harvestDurationDays: null,
    bandStartDay: 0,
    bandEndDay: 60,
    daysLeftInHarvest: null,
    ratio: 45 / 60,
    daysToHarvest: 15,
    logDays: [],
    ...overrides,
  };
}

describe('ProgressBand', () => {
  it('目安が無ければ（ratio null）何も描かない', () => {
    render(<ProgressBand progress={progress({ ratio: null })} width={WIDTH} />);

    expect(screen.queryByTestId('progress-band-window')).toBeNull();
    expect(screen.UNSAFE_queryAllByType('RNSVGRect' as never)).toHaveLength(0);
  });

  describe('収穫の窓', () => {
    it('幅の最小の位置から右端までを塗る', () => {
      render(
        <ProgressBand
          progress={progress({
            harvestWindow: { min: 50, max: 70 },
            harvestAfterDays: 70,
            bandEndDay: 70,
          })}
          width={WIDTH}
        />,
      );

      const window = screen.getByTestId('progress-band-window');
      // 50/70 → 71px から右端まで
      expect(window.props.x).toBe(71);
      expect(window.props.width).toBe(29);
    });

    it('角丸を付けない（左端が丸まると窓の始まりが実際より右に見える）', () => {
      render(
        <ProgressBand
          progress={progress({
            harvestWindow: { min: 50, max: 70 },
            harvestAfterDays: 70,
            bandEndDay: 70,
          })}
          width={WIDTH}
        />,
      );

      expect(screen.getByTestId('progress-band-window').props.rx).toBeUndefined();
    });

    it('面は harvestLine、始まりのティックは harvest（薄すぎて見えなかった）', () => {
      render(
        <ProgressBand
          progress={progress({
            harvestWindow: { min: 50, max: 70 },
            harvestAfterDays: 70,
            bandEndDay: 70,
          })}
          width={WIDTH}
        />,
      );

      expect(screen.getByTestId('progress-band-window').props.fill.payload).toBe(
        fillPayload(Colors.harvestLine),
      );
      const tick = screen.getByTestId('progress-band-window-tick');
      expect(tick.props.fill.payload).toBe(fillPayload(Colors.harvest));
      expect(tick.props.x).toBe(71);
    });

    it('幅を持たない作物には描かない', () => {
      render(<ProgressBand progress={progress()} width={WIDTH} />);

      expect(screen.queryByTestId('progress-band-window')).toBeNull();
      expect(screen.queryByTestId('progress-band-window-tick')).toBeNull();
    });

    it('軸が採り入れ期間に切り替わっているときは描かない（帯そのものが収穫期間）', () => {
      render(
        <ProgressBand
          progress={progress({
            state: 'harvesting',
            harvestWindow: { min: 50, max: 70 },
            harvestDurationDays: 40,
            bandStartDay: 60,
            bandEndDay: 100,
            ratio: 0.25,
          })}
          width={WIDTH}
        />,
      );

      expect(screen.queryByTestId('progress-band-window')).toBeNull();
    });
  });

  describe('帯の色', () => {
    /** 窓の無い帯は「残り」「済み」の 2 枚。済みの塗りが 2 枚目 */
    function fillOfBar(): number {
      const rects = screen.UNSAFE_getAllByType('RNSVGRect' as never);
      expect(rects).toHaveLength(2);
      return rects[1].props.fill.payload as number;
    }

    it('育っている間は accent', () => {
      render(<ProgressBand progress={progress()} width={WIDTH} />);
      expect(fillOfBar()).toBe(fillPayload(Colors.accent));
    });

    it('due（未収穫で目安超過）は収穫色', () => {
      render(<ProgressBand progress={progress({ state: 'due', ratio: 1 })} width={WIDTH} />);
      expect(fillOfBar()).toBe(fillPayload(Colors.harvest));
    });

    it('over（幅の最大も過ぎて未収穫）も収穫色', () => {
      render(<ProgressBand progress={progress({ state: 'over', ratio: 1 })} width={WIDTH} />);
      expect(fillOfBar()).toBe(fillPayload(Colors.harvest));
    });

    it('収穫中は正常な状態なので accent のまま', () => {
      render(<ProgressBand progress={progress({ state: 'harvesting', ratio: 1 })} width={WIDTH} />);
      expect(fillOfBar()).toBe(fillPayload(Colors.accent));
    });
  });

  describe('作業ログのドット', () => {
    it('軸の上の位置に打ち、端からはみ出さないようクランプする', () => {
      render(<ProgressBand progress={progress({ logDays: [0, 30, 60] })} width={WIDTH} />);

      const dots = screen.UNSAFE_getAllByType('RNSVGCircle' as never);
      expect(dots.map((dot) => dot.props.cx)).toEqual([2, 50, 98]);
    });

    it('軸が採り入れ期間なら、その軸で打つ', () => {
      render(
        <ProgressBand
          progress={progress({
            state: 'harvesting',
            bandStartDay: 60,
            bandEndDay: 100,
            ratio: 0.5,
            logDays: [80],
          })}
          width={WIDTH}
        />,
      );

      const dots = screen.UNSAFE_getAllByType('RNSVGCircle' as never);
      expect(dots[0].props.cx).toBe(50);
    });
  });
});

describe('ProgressBand の読み上げ', () => {
  it('progressbar として読め、進み具合を 0〜100 で持つ', () => {
    render(<ProgressBand progress={progress()} width={70} />);

    const band = screen.getByTestId('progress-band');
    expect(band.props.accessibilityRole).toBe('progressbar');
    // 帯の右端は軸の終わり。既定のフィクスチャは 60 日目安で 45 日目
    expect(band.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 75 });
  });

  it('ラベルに収穫の窓と作業ログの件数が入る', () => {
    render(
      <ProgressBand
        progress={progress({
          harvestAfterDays: 70,
          harvestWindow: { min: 60, max: 70 },
          bandEndDay: 70,
          ratio: 45 / 70,
          logDays: [5, 20, 35],
        })}
        width={70}
      />,
    );

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
