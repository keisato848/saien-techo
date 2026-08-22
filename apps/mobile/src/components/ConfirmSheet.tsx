/**
 * Destructive action confirmation bottom sheet
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors } from '../constants/theme';
import { BottomSheet } from './BottomSheet';

interface ConfirmSheetProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  destructive?: boolean;
}

export function ConfirmSheet({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = '確認',
  destructive = true,
}: ConfirmSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.buttons}>
        <Pressable style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </Pressable>
        <Pressable
          style={[styles.confirmButton, destructive && styles.destructiveButton]}
          onPress={onConfirm}
        >
          <Text style={[styles.confirmText, destructive && styles.destructiveText]}>
            {confirmLabel}
          </Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: 13,
    color: Colors.inkDim,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: 'center',
  },
  buttons: {
    flexDirection: 'row',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    color: Colors.inkDim,
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  destructiveButton: {
    backgroundColor: Colors.dangerSoft,
    borderWidth: 1,
    borderColor: Colors.dangerLine,
  },
  confirmText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.onAccent,
  },
  destructiveText: {
    color: Colors.danger,
  },
});
