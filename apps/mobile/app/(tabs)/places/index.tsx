/**
 * S05: 場所（区画）管理 — R02 / WBS 1.6
 *
 * 設定から入る管理画面。栽培フォームの場所ピッカーの元になる。
 * 並べ替えを持つのは、ピッカーの並びが「畑を歩く順」であってほしいため
 * （名前順だと現実の配置と対応しない）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { ArchiveRestore, ChevronDown, ChevronLeft, ChevronUp, Plus } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../../../src/components/EmptyState';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { Toast } from '../../../src/components/Toast';
import { Colors, Typography } from '../../../src/constants/theme';
import {
  archivePlace,
  getPlaceDetailList,
  movePlace,
  PLACE_KIND_LABEL,
  unarchivePlace,
} from '../../../src/services/place.service';
import type { PlaceDetail } from '../../../src/services/types';

export default function PlaceListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [places, setPlaces] = useState<PlaceDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPlaces(await getPlaceDetailList());
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const active = places.filter((place) => place.archivedAt == null);
  const archived = places.filter((place) => place.archivedAt != null);

  const handleArchive = useCallback(
    (place: PlaceDetail) => {
      Alert.alert(
        `「${place.name}」を使わなくする`,
        place.plantingCount > 0
          ? `この場所の栽培 ${place.plantingCount} 件の記録はそのまま残り、場所名も表示されます。新しい栽培では選べなくなります。`
          : '新しい栽培では選べなくなります。あとから戻せます。',
        [
          { text: 'キャンセル', style: 'cancel' },
          {
            text: '使わなくする',
            style: 'destructive',
            onPress: () => {
              void archivePlace(place.id).then(() => {
                setToast(`「${place.name}」を使わなくしました`);
                return load();
              });
            },
          },
        ],
      );
    },
    [load],
  );

  if (loading) return <Loading />;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>場所の管理</Text>
        <PressableScale
          style={styles.addButton}
          onPress={() => router.push('/places/new')}
          accessibilityLabel="場所を追加"
        >
          <Plus size={18} color={Colors.onAccent} />
        </PressableScale>
      </View>

      {places.length === 0 ? (
        <EmptyState
          icon="🪴"
          title="まだ場所がありません"
          message="プランターや畝を登録しておくと、栽培を登録するときに選べます。"
          actionLabel="場所を追加"
          onAction={() => router.push('/places/new')}
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.sectionLabel}>使っている場所</Text>
          {active.length === 0 ? (
            <Text style={styles.hint}>すべて「使わない」にしています。</Text>
          ) : (
            active.map((place, index) => (
              <View key={place.id} style={styles.card}>
                <Pressable
                  style={styles.cardMain}
                  onPress={() => router.push(`/places/${place.id}/edit`)}
                >
                  <Text style={styles.name}>{place.name}</Text>
                  <Text style={styles.meta}>
                    {[
                      place.kind ? PLACE_KIND_LABEL[place.kind] : null,
                      place.growingCount > 0
                        ? `育成中 ${place.growingCount}`
                        : place.plantingCount > 0
                          ? `記録 ${place.plantingCount}`
                          : '栽培なし',
                    ]
                      .filter(Boolean)
                      .join(' ・ ')}
                  </Text>
                  {place.note ? (
                    <Text style={styles.note} numberOfLines={1}>
                      {place.note}
                    </Text>
                  ) : null}
                </Pressable>

                <View style={styles.cardActions}>
                  <Pressable
                    hitSlop={8}
                    disabled={index === 0}
                    onPress={() => void movePlace(place.id, 'up').then(load)}
                    accessibilityLabel={`${place.name}を上へ`}
                  >
                    <ChevronUp size={20} color={index === 0 ? Colors.line : Colors.inkDim} />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    disabled={index === active.length - 1}
                    onPress={() => void movePlace(place.id, 'down').then(load)}
                    accessibilityLabel={`${place.name}を下へ`}
                  >
                    <ChevronDown
                      size={20}
                      color={index === active.length - 1 ? Colors.line : Colors.inkDim}
                    />
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => handleArchive(place)}
                    accessibilityLabel={`${place.name}を使わなくする`}
                  >
                    <Text style={styles.archiveText}>使わない</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {archived.length > 0 ? (
            <>
              <Text style={[styles.sectionLabel, styles.sectionLabelSpaced]}>使っていない場所</Text>
              {archived.map((place) => (
                <View key={place.id} style={[styles.card, styles.cardArchived]}>
                  <View style={styles.cardMain}>
                    <Text style={[styles.name, styles.nameArchived]}>{place.name}</Text>
                    <Text style={styles.meta}>
                      {place.plantingCount > 0 ? `記録 ${place.plantingCount}` : '栽培なし'}
                    </Text>
                  </View>
                  <Pressable
                    hitSlop={8}
                    style={styles.restoreButton}
                    onPress={() =>
                      void unarchivePlace(place.id).then(() => {
                        setToast(`「${place.name}」を戻しました`);
                        return load();
                      })
                    }
                  >
                    <ArchiveRestore size={16} color={Colors.accent} />
                    <Text style={styles.restoreText}>戻す</Text>
                  </Pressable>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
      )}

      <Toast message={toast ?? ''} visible={toast != null} onDismiss={() => setToast(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 12,
  },
  title: {
    flex: 1,
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  sectionLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 2 },
  sectionLabelSpaced: { marginTop: 20 },
  hint: { fontSize: Typography.size.sm, color: Colors.inkDim },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  cardArchived: { backgroundColor: Colors.bg },
  cardMain: { flex: 1, gap: 3 },
  name: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  nameArchived: { color: Colors.inkDim },
  meta: { fontSize: Typography.size.xs, color: Colors.inkDim },
  note: { fontSize: Typography.size.xs, color: Colors.inkDim },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  archiveText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  restoreButton: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  restoreText: { fontSize: Typography.size.sm, color: Colors.accent },
});
