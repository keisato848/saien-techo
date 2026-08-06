/**
 * 初回起動の聞き取り（WBS 3.6）
 *
 * インストール直後に、栽培暦を引くのに必要な最小限だけを聞く。
 * 質問は「菜園の名前（任意）」と「地域帯」の 2 つで打ち止め —
 * 初回に長い設定を並べるほど、最初の記録へたどり着く前に閉じられる。
 *
 * ルートではなく**全画面のかぶせ**にしている。ナビゲーションに載せると
 * 初回判定と初期ルートの競走（ホームが一瞬見える）を作り込みやすい。
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Typography } from '../constants/theme';
import { DEFAULT_REGION, type Region } from '../services/region.service';
import { PressableScale } from './PressableScale';
import { RegionOptions } from './RegionOptions';

interface OnboardingSheetProps {
  onDone: (region: Region, gardenName: string) => Promise<void> | void;
}

export function OnboardingSheet({ onDone }: OnboardingSheetProps) {
  const insets = useSafeAreaInsets();
  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [gardenName, setGardenName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onDone(region, gardenName.trim());
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.root} testID="onboarding-sheet">
      <ScrollView
        contentContainerStyle={[
          styles.body,
          { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>さいえん手帳</Text>
        <Text style={styles.title}>ようこそ</Text>
        <Text style={styles.lead}>
          お住まいの地域に合わせて、種まき・植え付けの時期をお知らせします。 設定は 2
          つだけ。あとからいつでも変えられます。
        </Text>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>
            菜園の名前 <Text style={styles.optional}>（任意）</Text>
          </Text>
          <TextInput
            style={styles.input}
            value={gardenName}
            onChangeText={setGardenName}
            placeholder="わたしの菜園"
            placeholderTextColor={Colors.inkDim}
            returnKeyType="done"
            accessibilityLabel="菜園の名前"
          />
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>お住まいの地域</Text>
          <RegionOptions value={region} onChange={setRegion} />
        </View>

        <PressableScale
          style={[styles.submit, saving && styles.submitDisabled]}
          onPress={() => void submit()}
          disabled={saving}
          accessibilityLabel="はじめる"
        >
          <Text style={styles.submitText}>{saving ? '準備中…' : 'はじめる'}</Text>
        </PressableScale>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: Colors.bg,
  },
  body: { paddingHorizontal: 24 },
  eyebrow: {
    fontSize: Typography.size.sm,
    color: Colors.accentInk,
    fontWeight: Typography.weight.medium,
    letterSpacing: 1,
  },
  title: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    color: Colors.ink,
    marginTop: 6,
  },
  lead: {
    fontSize: Typography.size.base,
    color: Colors.inkDim,
    lineHeight: 24,
    marginTop: 12,
    marginBottom: 28,
  },
  group: { marginBottom: 24 },
  groupLabel: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    marginBottom: 10,
  },
  optional: { color: Colors.inkDim },
  input: {
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: Typography.size.md,
    color: Colors.ink,
  },
  submit: {
    marginTop: 8,
    paddingVertical: 15,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    alignItems: 'center',
  },
  submitDisabled: { opacity: 0.6, borderRadius: 12 },
  submitText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
});
