/**
 * Labeled text input with error display
 */
import { useState } from 'react';
import { StyleSheet, Text, TextInput, type TextInputProps, View } from 'react-native';

import { Colors } from '../constants/theme';

interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string;
  required?: boolean;
}

/** styles.input の paddingVertical(10×2) + borderWidth(1×2) */
const INPUT_CHROME_HEIGHT = 22;

export function FormField({
  label,
  error,
  required,
  style,
  multiline,
  onContentSizeChange,
  ...props
}: FormFieldProps) {
  // Grow multiline fields to fit their content (minHeight in `style` floors it).
  const [contentHeight, setContentHeight] = useState(0);

  /*
   * 複数行の高さは**ここで確定させる**。
   *
   * `minHeight` だけに任せると、Android のネイティブ側は minHeight を
   * 「文字の入る領域」の下限として扱い、その上に padding を足して描画する。
   * 一方で RN のレイアウトは `height`(= 文字の高さ) しか見ないため、
   * 描画のほうが背高くなり、直後に置いた要素と重なる
   * （資材の編集画面で削除ボタンがメモ欄に食い込んだ）。
   * 枠まで含めた高さを自分で計算して `height` に入れれば、
   * レイアウトと描画が必ず一致する。
   */
  const floor = (StyleSheet.flatten(style) as { minHeight?: number } | undefined)?.minHeight ?? 0;
  const grownHeight = contentHeight > 0 ? Math.max(contentHeight + INPUT_CHROME_HEIGHT, floor) : 0;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>
        {label}
        {required && <Text style={styles.required}> *</Text>}
      </Text>
      <TextInput
        style={[
          styles.input,
          error ? styles.inputError : undefined,
          style,
          multiline && grownHeight > 0 ? { height: grownHeight } : undefined,
        ]}
        multiline={multiline}
        onContentSizeChange={(e) => {
          if (multiline) setContentHeight(e.nativeEvent.contentSize.height);
          onContentSizeChange?.(e);
        }}
        placeholderTextColor={Colors.muted}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13, // sm: フォームラベル
    fontWeight: '500',
    color: Colors.paperDim,
    marginBottom: 6,
    letterSpacing: 0.5,
  },
  required: {
    color: Colors.gold,
  },
  input: {
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15, // base: 入力テキスト
    fontWeight: '400',
    color: Colors.paper,
  },
  inputError: {
    borderColor: Colors.danger,
  },
  error: {
    fontSize: 12, // xs: エラーメッセージ
    fontWeight: '400',
    color: Colors.danger,
    marginTop: 4,
  },
});
