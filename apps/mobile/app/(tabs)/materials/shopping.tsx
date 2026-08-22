/**
 * S09: 買い物リスト — R12 / WBS 2.7
 *
 * 資材の一覧から入る。ホームセンターで片手で使うので、
 * **入力欄を上に固定**し、チェックは行のどこを押しても効くようにしている。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, ChevronLeft, Plus, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  addGardenShoppingItem,
  addLowMaterialsToShoppingList,
  clearCheckedGardenShoppingItems,
  getGardenShoppingItems,
  removeGardenShoppingItem,
  setGardenShoppingItemChecked,
} from '../../../src/services/garden-shopping.service';
import { MATERIAL_CATEGORY_LABEL } from '../../../src/services/material.service';
import type { GardenShoppingItem } from '../../../src/services/types';

export default function GardenShoppingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<GardenShoppingItem[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setItems(await getGardenShoppingItems());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const add = async () => {
    if (draft.trim().length === 0) return;
    const id = await addGardenShoppingItem(draft);
    setDraft('');
    if (id == null) {
      Alert.alert('もう入っています', 'この品物はすでに買い物リストにあります。');
      return;
    }
    await load();
  };

  const addLow = async () => {
    const added = await addLowMaterialsToShoppingList();
    await load();
    if (added === 0) {
      Alert.alert(
        '追加するものがありません',
        '残りわずかの資材が無いか、すでに買い物リストに入っています。',
      );
    }
  };

  const clearChecked = () => {
    Alert.alert('買ったものを消しますか', 'チェックの付いた品物をリストから消します。', [
      { text: 'キャンセル', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () => {
          void clearCheckedGardenShoppingItems().then(load);
        },
      },
    ]);
  };

  const checkedCount = items.filter((item) => item.checked).length;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>買い物</Text>
        {checkedCount > 0 ? (
          <Pressable onPress={clearChecked} hitSlop={8}>
            <Text style={styles.headerAction}>買ったものを消す</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="支柱、麻ひも、化成肥料…"
          placeholderTextColor={Colors.inkDim}
          returnKeyType="done"
          onSubmitEditing={() => void add()}
          accessibilityLabel="買うものを入力"
        />
        <PressableScale
          style={[styles.addButton, draft.trim().length === 0 && styles.addButtonDisabled]}
          onPress={() => void add()}
          accessibilityLabel="買い物リストに追加"
        >
          <Plus size={18} color={Colors.onAccent} />
        </PressableScale>
      </View>

      <PressableScale style={styles.lowButton} onPress={() => void addLow()}>
        <Text style={styles.lowButtonText}>残りわずかの資材をまとめて入れる</Text>
      </PressableScale>

      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <EmptyState
          icon="🛒"
          title="買うものはありません"
          message="足りないものを書き足しておくと、ホームセンターで迷いません。"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          {items.map((item) => (
            <View key={item.id} style={styles.row}>
              <Pressable
                style={styles.rowMain}
                onPress={() => void setGardenShoppingItemChecked(item.id, !item.checked).then(load)}
                accessibilityLabel={`${item.name}を${item.checked ? '買っていないことにする' : '買った'}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
              >
                <View style={[styles.check, item.checked && styles.checkOn]}>
                  {item.checked ? <Check size={14} color={Colors.onAccent} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.name, item.checked && styles.nameChecked]}>
                    {item.name}
                    {item.amount ? <Text style={styles.amount}>　{item.amount}</Text> : null}
                  </Text>
                  {item.materialCategory ? (
                    <Text style={styles.meta}>
                      {MATERIAL_CATEGORY_LABEL[item.materialCategory]}　買うと在庫が 1 増えます
                    </Text>
                  ) : null}
                </View>
              </Pressable>

              <Pressable
                hitSlop={10}
                onPress={() => void removeGardenShoppingItem(item.id).then(load)}
                accessibilityLabel={`${item.name}をリストから消す`}
              >
                <X size={16} color={Colors.inkDim} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    flex: 1,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerAction: { fontSize: Typography.size.sm, color: Colors.accentInk },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.surfaceInput,
    borderWidth: 1,
    borderColor: Colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: Typography.size.base,
    color: Colors.ink,
  },
  addButton: {
    // 高さは必ず書く。PressableScale は style を内側の Pressable に渡すので、
    // 行の stretch は外側の Animated.View までしか効かず、内側は潰れる
    width: 46,
    height: 46,
    borderRadius: 10,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { opacity: 0.4, borderRadius: 10 },
  lowButton: {
    marginHorizontal: 16,
    marginBottom: 14,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.accent,
    alignItems: 'center',
  },
  lowButtonText: { fontSize: Typography.size.sm, color: Colors.accentInk },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowText: { flex: 1, gap: 3 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: Colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderRadius: 11, backgroundColor: Colors.accent, borderColor: Colors.accent },
  name: { fontSize: Typography.size.base, color: Colors.ink },
  nameChecked: { color: Colors.inkDim, textDecorationLine: 'line-through' },
  amount: { fontSize: Typography.size.sm, color: Colors.inkDim },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
});
