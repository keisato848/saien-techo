/**
 * 短い完了通知（既定 2 秒で自動的に消える）
 *
 * ## 呼び出し側の前提
 *
 * `onDismiss` は **インラインの矢印関数で渡してよい**（`onDismiss={() => setMsg(null)}`）。
 * 関数の identity が毎回変わっても、アニメーションは中断されない。
 * これを保証するために内部で ref に逃がしている — 依存配列に入れると、
 * 親が再描画するたびに走行中の `Animated.sequence` が作り直される。
 *
 * ## #92 の経緯（この作りにした理由）
 *
 * 以前は `onDismiss` を依存配列に入れ、`start(cb)` の `finished` も見ていなかった。
 * その結果:
 *   1. 親の再描画で effect が再実行される
 *   2. 走行中の sequence が**中断**される
 *   3. `Animated.sequence(...).start(cb)` は**中断でも cb を呼ぶ**
 *   4. → `onDismiss()` が即発火してトーストが消える
 *
 * backup.tsx の復元は `setToastMessage(...)` の直後に `refresh()` で再描画するため必ず踏み、
 * 「復元は成功しているのに何も起きていないように見える」状態になっていた。
 * 作成系は `await refresh()` を先に済ませていたので踏まなかった。
 *
 * **jest では再現しない**（Animated のモックが中断時のコールバックを再現しないため）。
 * 実機・エミュレータでの確認が要る。
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';

import { Colors } from '../constants/theme';

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, visible, onDismiss, duration = 2000 }: ToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;

  // 依存配列に入れないための逃がし。毎描画で最新の関数に更新する
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!visible) return;

    // message が差し替わったときもここから作り直す = 表示時間を数え直す。
    // 依存に message を入れないと、2 件目が 1 件目の残り時間で消える
    opacity.setValue(0);

    const animation = Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(duration),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]);

    animation.start(({ finished }) => {
      // **中断されたときは何もしない。** finished を見ないと、作り直しのたびに
      // 前の sequence のコールバックが発火してトーストが即消えする（#92）
      if (finished) onDismissRef.current();
    });

    return () => animation.stop();
  }, [visible, message, duration, opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  text: {
    fontSize: 13,
    color: Colors.paper,
  },
});
