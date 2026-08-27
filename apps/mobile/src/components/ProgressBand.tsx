import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { Colors } from '../constants/theme';
import type { PlantingProgress } from '../services/growth-progress.service';

/**
 * 進行帯 — 植え付けから収穫の目安までの進み具合を 1 本で見せる。
 *
 * 設計は `docs/検討-ホームの進行帯と気温.md` §4 案 A。要点だけ再掲する:
 *
 * - **塗り = 確定した過去、残り = これから。** 確信度は % ではなく塗りの境界で示す
 * - **▲ = 今日。** 位置は帯の上のマーカーと、カード側の「N 日目」で二重に示す
 * - **下の小さなドット = 作業ログ。** 記録すると帯に印が増える
 * - **凡例は置かない。** ホームで凡例が要る色分けは、その時点で複雑すぎる
 *
 * **幅のある「収穫窓」は描かない。** 幅を出せるデータが無いため
 * （理由は growth-progress.service の冒頭）。目安は 1 点として右端に置く。
 */
interface ProgressBandProps {
  progress: PlantingProgress;
  width: number;
}

const HEIGHT = 26;
const BAR_Y = 9;
const BAR_H = 8;

export function ProgressBand({ progress, width }: ProgressBandProps) {
  // 目安が無い作物（自由入力）は帯を描かない。
  // 0% の帯を出すと「まだ何も進んでいない」に見えてしまう
  if (progress.ratio == null) return <View style={{ height: HEIGHT }} />;

  const filled = Math.max(2, Math.round(width * progress.ratio));
  // 「due（未収穫で目安超過）」だけ収穫色。収穫中は正常な状態なので緑のまま
  const due = progress.state === 'due';
  const target = progress.harvestAfterDays ?? 1;
  // 満杯の帯では今日マーカーが意味を持たず、右端で切れて欠けにも見えるので出さない
  const showToday = progress.ratio < 1;

  return (
    <View style={styles.root}>
      <Svg width={width} height={HEIGHT}>
        {/* 残り */}
        <Rect
          x={0}
          y={BAR_Y}
          width={width}
          height={BAR_H}
          rx={BAR_H / 2}
          fill={Colors.surfaceInput}
        />
        {/* 済み。目安を過ぎたら収穫色にして「採りどき」を目で分かるようにする */}
        <Rect
          x={0}
          y={BAR_Y}
          width={filled}
          height={BAR_H}
          rx={BAR_H / 2}
          fill={due ? Colors.harvest : Colors.accent}
        />
        {/* 作業ログのドット */}
        {progress.logDays.map((day) => (
          <Circle
            key={day}
            cx={Math.min(width - 2, Math.max(2, (day / target) * width))}
            cy={BAR_Y + BAR_H + 6}
            r={1.8}
            fill={Colors.accentLine}
          />
        ))}
        {/* 今日。端で三角が切れないよう位置をクランプする */}
        {showToday ? (
          <Path
            d={`M ${Math.max(4, Math.min(width - 4, filled)) - 4} 4 L ${Math.max(4, Math.min(width - 4, filled)) + 4} 4 L ${Math.max(4, Math.min(width - 4, filled))} 8 Z`}
            fill={Colors.accentInk}
          />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: HEIGHT },
});
