/**
 * ギャラリー — R05 / WBS 2.3
 *
 * 菜園の写真をぜんぶ 1 本に並べる。作業ログの写真も収穫の写真も混ぜる。
 * 収穫だけを見たいときは収穫タブのアルバム（R07 / WBS 2.2）がある。
 *
 * アルバムが月別グリッドなのに対し、こちらは**日付で区切らない密なグリッド**。
 * 「いつ撮ったか」ではなく「どんな写真があるか」を眺めるための画面なので、
 * 見出しを挟まず 1 画面に多く入れる。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '../src/components/EmptyState';
import { Loading } from '../src/components/Loading';
import { PressableScale } from '../src/components/PressableScale';
import { Colors, Typography } from '../src/constants/theme';
import { getTimeline } from '../src/services/garden-timeline.service';
import { flattenGardenPhotos, type GardenPhoto } from '../src/utils/gardenCalendar';

const COLUMNS = 3;
const GAP = 3;
const PADDING = 12;

export default function GalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [photos, setPhotos] = useState<GardenPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  const cellSize = Math.floor((width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS);

  const load = useCallback(async () => {
    setPhotos(flattenGardenPhotos(await getTimeline()));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="閉じる">
          <X size={20} color={Colors.inkDim} />
        </Pressable>
        <Text style={styles.title}>写真</Text>
        <Text style={styles.count}>{photos.length > 0 ? photos.length : ''}</Text>
      </View>

      {loading ? (
        <Loading />
      ) : photos.length === 0 ? (
        <EmptyState
          icon="📷"
          title="まだ写真がありません"
          message="作業ログや収穫に写真を付けると、ここにまとまります。"
        />
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.grid}>
            {photos.map((photo) => (
              <PressableScale
                key={photo.key}
                onPress={() =>
                  router.push(
                    photo.type === 'harvest'
                      ? `/plantings/${photo.plantingId}/harvests/${photo.entryId}`
                      : `/plantings/${photo.plantingId}/care-logs/${photo.entryId}`,
                  )
                }
                accessibilityLabel={`${photo.cropName}の写真`}
              >
                <Image
                  source={{ uri: photo.uri }}
                  style={[styles.photo, { width: cellSize, height: cellSize }]}
                />
                {/* 収穫の写真は角に暖色の印を置く。混在するので出所が分かる必要がある */}
                {photo.type === 'harvest' ? <View style={styles.harvestMark} /> : null}
              </PressableScale>
            ))}
          </View>
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  count: {
    fontSize: Typography.size.sm,
    color: Colors.inkDim,
    minWidth: 20,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  body: { paddingHorizontal: PADDING, paddingBottom: 32 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  photo: { borderRadius: 4, backgroundColor: Colors.surfaceInput },
  harvestMark: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.harvest,
  },
});
