/**
 * 複数写真の入力（R04：作業ログに最大 6 枚）
 *
 * だいどこの PhotoPickerField は 1 枚用なので新設した。
 * 選んだ時点で端末内へコピーし、パスの配列を返す。ファイルの削除は
 * 保存時にサービス側でまとめて行う（キャンセルで戻せるようにするため、
 * ここでは外した写真のファイルを消さない）。
 */
import { Camera, ImageIcon, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, Typography } from '../constants/theme';
import { expoImagePickerPhotoCaptureAdapter } from '../services/expo-photo-capture.adapter';
import { capturePhoto, type PhotoCaptureSource } from '../services/photo-capture.service';
import {
  MAX_GARDEN_PHOTOS,
  PhotoCompressionError,
  persistGardenPhotos,
} from '../services/photo-storage.service';

interface PhotoGridFieldProps {
  value: string[];
  onChange: (paths: string[]) => void;
  max?: number;
}

export function PhotoGridField({ value, onChange, max = MAX_GARDEN_PHOTOS }: PhotoGridFieldProps) {
  const [busy, setBusy] = useState(false);
  // 保存できなかったことを黙って捨てない（fail closed にしたので無反応に見えてしまう）
  const [error, setError] = useState<string | null>(null);
  const full = value.length >= max;

  const handlePick = useCallback(
    async (source: PhotoCaptureSource) => {
      if (full) return;
      setBusy(true);
      setError(null);
      try {
        const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
        const [path] = await persistGardenPhotos([photo]);
        onChange([...value, path]);
      } catch (e) {
        // キャンセルは何も出さない。保存できなかったときだけ理由を見せる
        if (e instanceof PhotoCompressionError) setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [full, onChange, value],
  );

  return (
    <View style={styles.container}>
      {value.length > 0 ? (
        <View style={styles.grid}>
          {value.map((uri, index) => (
            <View key={`${uri}-${index}`} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
              <Pressable
                style={styles.removeBadge}
                onPress={() => onChange(value.filter((_, i) => i !== index))}
                hitSlop={8}
                accessibilityLabel={`${index + 1}枚目の写真を外す`}
              >
                <X size={12} color={Colors.white} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.buttonRow}>
        {busy ? (
          <ActivityIndicator color={Colors.accent} size="small" />
        ) : (
          <>
            <Pressable
              style={[styles.pickButton, full && styles.pickButtonDisabled]}
              onPress={() => handlePick('camera')}
              disabled={full}
              accessibilityLabel="写真を撮影"
            >
              <Camera size={15} color={full ? Colors.inkDim : Colors.accentInk} />
              <Text style={[styles.pickButtonText, full && styles.pickButtonTextDisabled]}>
                撮影
              </Text>
            </Pressable>
            <Pressable
              style={[styles.pickButton, full && styles.pickButtonDisabled]}
              onPress={() => handlePick('gallery')}
              disabled={full}
              accessibilityLabel="ギャラリーから選ぶ"
            >
              <ImageIcon size={15} color={full ? Colors.inkDim : Colors.accentInk} />
              <Text style={[styles.pickButtonText, full && styles.pickButtonTextDisabled]}>
                ギャラリー
              </Text>
            </Pressable>
          </>
        )}
        <Text style={styles.count}>
          {value.length} / {max}
        </Text>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { position: 'relative' },
  thumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: Colors.surfaceInput },
  removeBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.inkDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  pickButtonDisabled: { borderColor: Colors.line, backgroundColor: Colors.surface },
  pickButtonText: { fontSize: Typography.size.sm, color: Colors.accentInk },
  pickButtonTextDisabled: { color: Colors.inkDim },
  count: { marginLeft: 'auto', fontSize: Typography.size.xs, color: Colors.inkDim },
  error: { fontSize: Typography.size.xs, color: Colors.danger },
});
