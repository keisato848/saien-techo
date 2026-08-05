/**
 * S03: 栽培詳細（R01 / WBS 1.5）
 *
 * WBS 1.5 の範囲は登録内容の表示と、終了/再開/削除。
 * 「やった！」の記録ボタンと作業ログは WBS 1.8、収穫は WBS 2.1 で足す。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ChevronLeft,
  Droplets,
  Leaf,
  Pencil,
  Plus,
  ShoppingBasket,
  RotateCcw,
  Scissors,
  ShieldCheck,
  Sprout,
  Trash2,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet } from '../../../src/components/BottomSheet';
import { ConfirmSheet } from '../../../src/components/ConfirmSheet';
import { Loading } from '../../../src/components/Loading';
import { PressableScale } from '../../../src/components/PressableScale';
import { TagChip } from '../../../src/components/TagChip';
import { Toast } from '../../../src/components/Toast';
import { Colors, Typography } from '../../../src/constants/theme';
import { formatDateLabel } from '../../../src/components/DateField';
import {
  CARE_KIND_LABEL,
  createCareLog,
  getCareLogs,
  QUICK_CARE_KINDS,
} from '../../../src/services/care-log.service';
import {
  getHarvests,
  getHarvestTotals,
  HARVEST_UNIT_LABEL,
} from '../../../src/services/harvest.service';
import {
  deletePlanting,
  endPlanting,
  getPlantingDetail,
  resumePlanting,
} from '../../../src/services/planting.service';
import type {
  CareLogItem,
  CareLogKind,
  HarvestItem,
  HarvestTotal,
  PlantingDetail,
  PlantingEndedReason,
} from '../../../src/services/types';
import {
  ENDED_REASON_LABEL,
  PLANTED_AS_LABEL,
  PLANTING_ENDED_REASONS,
} from '../../../src/validation/planting.schema';

export default function PlantingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [planting, setPlanting] = useState<PlantingDetail | null>(null);
  const [careLogs, setCareLogs] = useState<CareLogItem[]>([]);
  const [harvests, setHarvests] = useState<HarvestItem[]>([]);
  const [totals, setTotals] = useState<HarvestTotal[]>([]);
  const [loading, setLoading] = useState(true);
  const [endSheetOpen, setEndSheetOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPlanting(await getPlantingDetail(id));
    setCareLogs(await getCareLogs(id));
    setHarvests(await getHarvests(id));
    setTotals(await getHarvestTotals(id));
    setLoading(false);
  }, [id]);

  /**
   * クイック記録（R04 の「1〜2 タップ」）。
   * 即保存してトーストを出すだけにして、メモ・写真は後から足せるようにする。
   * ここでシートを挟むとタップ数が増えて要件を満たせない。
   */
  const handleQuickLog = useCallback(
    async (kind: CareLogKind) => {
      await createCareLog({ plantingId: id, kind });
      await load();
      setToast(`${CARE_KIND_LABEL[kind]}を記録しました`);
    },
    [id, load],
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const handleEnd = useCallback(
    async (reason: PlantingEndedReason) => {
      setEndSheetOpen(false);
      await endPlanting(id, reason);
      await load();
      setToast('栽培を終了しました');
    },
    [id, load],
  );

  const handleResume = useCallback(async () => {
    await resumePlanting(id);
    await load();
    setToast('育成中に戻しました');
  }, [id, load]);

  const handleDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    await deletePlanting(id);
    router.replace('/(tabs)/plantings');
  }, [id, router]);

  if (loading) return <Loading />;

  if (!planting) {
    return (
      <View style={styles.missing}>
        <Text style={styles.missingText}>この栽培は見つかりませんでした</Text>
        <PressableScale style={styles.missingButton} onPress={() => router.back()}>
          <Text style={styles.missingButtonText}>戻る</Text>
        </PressableScale>
      </View>
    );
  }

  const ended = planting.endedAt != null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ChevronLeft size={22} color={Colors.ink} />
        </Pressable>
        <Pressable onPress={() => router.push(`/plantings/${planting.id}/edit`)} hitSlop={12}>
          <Pencil size={18} color={Colors.accent} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {planting.coverPhotoUri ? (
          <Image source={{ uri: planting.coverPhotoUri }} style={styles.cover} />
        ) : null}

        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            <Text style={styles.cropName}>{planting.cropName}</Text>
            {planting.variety ? <Text style={styles.variety}>{planting.variety}</Text> : null}
          </View>
          <View style={styles.elapsed}>
            <Text style={styles.elapsedNumber}>{planting.elapsedDays}</Text>
            <Text style={styles.elapsedUnit}>日目</Text>
          </View>
        </View>

        {ended ? (
          <View style={styles.endedBanner}>
            <Text style={styles.endedText}>
              {formatDateLabel(planting.endedAt as string)}に終了（
              {planting.endedReason ? ENDED_REASON_LABEL[planting.endedReason] : '—'}）
            </Text>
          </View>
        ) : null}

        <View style={styles.infoCard}>
          <InfoRow label="植え付け日" value={formatDateLabel(planting.plantedOn)} />
          <InfoRow label="種 / 苗" value={PLANTED_AS_LABEL[planting.plantedAs]} />
          <InfoRow label="場所" value={planting.placeName ?? '未設定'} />
        </View>

        {planting.tags.length > 0 ? (
          <View style={styles.tags}>
            {planting.tags.map((tag) => (
              <TagChip key={tag} label={tag} />
            ))}
          </View>
        ) : null}

        {planting.note ? (
          <View style={styles.noteCard}>
            <Text style={styles.sectionLabel}>メモ</Text>
            <Text style={styles.noteText}>{planting.note}</Text>
          </View>
        ) : null}

        {!ended ? (
          <View style={styles.quickCard}>
            <Text style={styles.sectionLabel}>やった！を記録</Text>
            <View style={styles.quickRow}>
              {QUICK_CARE_KINDS.map((kind) => (
                <PressableScale
                  key={kind}
                  containerStyle={styles.flexItem}
                  style={styles.quickButton}
                  onPress={() => void handleQuickLog(kind)}
                  accessibilityLabel={`${CARE_KIND_LABEL[kind]}を記録`}
                >
                  <CareKindIcon kind={kind} />
                  <Text style={styles.quickText}>{CARE_KIND_LABEL[kind]}</Text>
                </PressableScale>
              ))}
            </View>
            {/*
              収穫は保存先が harvests で違うが、利用者にとっては同じ「やったことの記録」。
              導線を分けると R06 の最短 3 タップに収まらないのでここに混ぜる。
              色だけ暖色にして、作業ログとは別物だと分かるようにしている。
            */}
            <PressableScale
              style={styles.harvestButton}
              onPress={() => router.push(`/plantings/${planting.id}/harvests/new`)}
              accessibilityLabel="収穫を記録"
            >
              <ShoppingBasket size={18} color={Colors.harvest} />
              <Text style={styles.harvestButtonText}>収穫した</Text>
            </PressableScale>

            <PressableScale
              style={styles.detailedButton}
              onPress={() => router.push(`/plantings/${planting.id}/care-logs/new`)}
            >
              <Plus size={14} color={Colors.accent} />
              <Text style={styles.detailedText}>写真やメモを付けて記録</Text>
            </PressableScale>
          </View>
        ) : null}

        <View style={styles.logSection}>
          <Text style={styles.sectionLabel}>作業ログ</Text>
          {careLogs.length === 0 ? (
            <Text style={styles.emptyLog}>まだ記録がありません。</Text>
          ) : (
            careLogs.map((log) => (
              <PressableScale
                key={log.id}
                style={styles.logRow}
                onPress={() => router.push(`/plantings/${planting.id}/care-logs/${log.id}`)}
              >
                <View style={styles.logDot} />
                <View style={styles.logBody}>
                  <Text style={styles.logKind}>{CARE_KIND_LABEL[log.kind]}</Text>
                  {log.note ? (
                    <Text style={styles.logNote} numberOfLines={2}>
                      {log.note}
                    </Text>
                  ) : null}
                  {log.photoUris.length > 0 ? (
                    <View style={styles.logPhotos}>
                      {log.photoUris.slice(0, 4).map((uri) => (
                        <Image key={uri} source={{ uri }} style={styles.logPhoto} />
                      ))}
                      {log.photoUris.length > 4 ? (
                        <Text style={styles.logPhotoMore}>+{log.photoUris.length - 4}</Text>
                      ) : null}
                    </View>
                  ) : null}
                </View>
                <Text style={styles.logDate}>{formatDateLabel(log.loggedAt)}</Text>
              </PressableScale>
            ))
          )}
        </View>

        {harvests.length > 0 ? (
          <View style={styles.logSection}>
            <View style={styles.harvestHeader}>
              <PressableScale
                onPress={() => router.push(`/harvests?plantingId=${planting.id}`)}
                accessibilityLabel="この栽培の収穫をアルバムで見る"
              >
                <Text style={styles.sectionLinkLabel}>収穫 ›</Text>
              </PressableScale>
              {totals.length > 0 ? (
                <View style={styles.totals}>
                  {totals.map((total) => (
                    <Text key={total.unit} style={styles.totalPill}>
                      {total.quantity}
                      {HARVEST_UNIT_LABEL[total.unit]}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>

            {/* 写真が主役なので、一覧は行ではなくサムネイルの並び（R06 / R07） */}
            <View style={styles.harvestGrid}>
              {harvests.map((harvest) => (
                <PressableScale
                  key={harvest.id}
                  style={styles.harvestCell}
                  onPress={() => router.push(`/plantings/${planting.id}/harvests/${harvest.id}`)}
                >
                  {harvest.photoUris.length > 0 ? (
                    <Image source={{ uri: harvest.photoUris[0] }} style={styles.harvestPhoto} />
                  ) : (
                    <View style={[styles.harvestPhoto, styles.harvestPhotoEmpty]}>
                      <ShoppingBasket size={20} color={Colors.harvest} />
                    </View>
                  )}
                  <Text style={styles.harvestCaption} numberOfLines={1}>
                    {harvest.quantity != null && harvest.unit
                      ? `${harvest.quantity}${HARVEST_UNIT_LABEL[harvest.unit]}`
                      : formatDateLabel(harvest.harvestedAt)}
                  </Text>
                </PressableScale>
              ))}
            </View>
          </View>
        ) : null}

        <View style={styles.actions}>
          {ended ? (
            <PressableScale style={styles.secondaryButton} onPress={handleResume}>
              <RotateCcw size={16} color={Colors.accentInk} />
              <Text style={styles.secondaryText}>育成中に戻す</Text>
            </PressableScale>
          ) : (
            <PressableScale style={styles.secondaryButton} onPress={() => setEndSheetOpen(true)}>
              <Sprout size={16} color={Colors.accentInk} />
              <Text style={styles.secondaryText}>栽培を終了する</Text>
            </PressableScale>
          )}

          <PressableScale
            style={styles.deleteButton}
            onPress={() => setDeleteConfirmOpen(true)}
            accessibilityLabel="この栽培を削除"
          >
            <Trash2 size={16} color={Colors.danger} />
            <Text style={styles.deleteText}>削除する</Text>
          </PressableScale>
        </View>
      </ScrollView>

      <BottomSheet
        visible={endSheetOpen}
        onClose={() => setEndSheetOpen(false)}
        title="栽培を終了する"
      >
        <Text style={styles.sheetHint}>
          記録は残ります。「終了した栽培」からいつでも見られます。
        </Text>
        {PLANTING_ENDED_REASONS.map((reason) => (
          <PressableScale
            key={reason}
            style={styles.sheetOption}
            onPress={() => void handleEnd(reason)}
          >
            <Text style={styles.sheetOptionText}>{ENDED_REASON_LABEL[reason]}</Text>
          </PressableScale>
        ))}
      </BottomSheet>

      <ConfirmSheet
        visible={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => void handleDelete()}
        title="この栽培を削除しますか"
        message="作業ログ・収穫・写真もまとめて消えます。元に戻せません。記録を残したい場合は「栽培を終了する」を選んでください。"
        confirmLabel="削除する"
        destructive
      />

      <Toast message={toast ?? ''} visible={toast != null} onDismiss={() => setToast(null)} />
    </View>
  );
}

function CareKindIcon({ kind }: { kind: CareLogKind }) {
  const color = Colors.accentInk;
  if (kind === 'water') return <Droplets size={18} color={color} />;
  if (kind === 'fertilize') return <Leaf size={18} color={color} />;
  if (kind === 'prune') return <Scissors size={18} color={color} />;
  if (kind === 'pest') return <ShieldCheck size={18} color={color} />;
  return <Sprout size={18} color={color} />;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
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
    paddingVertical: 14,
  },
  body: { paddingHorizontal: 16, paddingBottom: 40, gap: 16 },
  cover: { width: '100%', height: 200, borderRadius: 12 },
  // 品種が無いと左が 1 行・右が 2 行になり flex-end では数値が浮くため center
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleBlock: { flex: 1, gap: 4 },
  cropName: {
    fontSize: Typography.size.lg,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  variety: { fontSize: Typography.size.sm, color: Colors.inkDim },
  elapsed: { alignItems: 'flex-end' },
  elapsedNumber: {
    fontSize: Typography.size.xl,
    fontWeight: Typography.weight.semibold,
    color: Colors.accent,
    fontVariant: ['tabular-nums'],
  },
  elapsedUnit: { fontSize: Typography.size.xs, color: Colors.inkDim },
  endedBanner: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.harvestSoft,
    borderWidth: 1,
    borderColor: Colors.harvestLine,
  },
  endedText: { fontSize: Typography.size.sm, color: Colors.harvest },
  infoCard: {
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    paddingHorizontal: 14,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.line,
  },
  infoLabel: { fontSize: Typography.size.sm, color: Colors.inkDim },
  infoValue: { fontSize: Typography.size.base, color: Colors.ink },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  noteCard: {
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 14,
    gap: 8,
  },
  sectionLabel: { fontSize: Typography.size.sm, color: Colors.inkDim },
  sectionLinkLabel: { fontSize: Typography.size.sm, color: Colors.harvest },
  flexItem: { flex: 1 },
  quickCard: {
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
    padding: 14,
    gap: 12,
  },
  quickRow: { flexDirection: 'row', gap: 8 },
  quickButton: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accentLine,
  },
  quickText: { fontSize: Typography.size.xs, color: Colors.accentInk },
  harvestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.harvestSoft,
    borderWidth: 1,
    borderColor: Colors.harvestLine,
  },
  harvestButtonText: {
    fontSize: Typography.size.base,
    color: Colors.harvest,
    fontWeight: Typography.weight.medium,
  },
  harvestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totals: { flexDirection: 'row', gap: 6 },
  totalPill: {
    fontSize: Typography.size.xs,
    color: Colors.harvest,
    backgroundColor: Colors.harvestSoft,
    borderWidth: 1,
    borderColor: Colors.harvestLine,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
    fontVariant: ['tabular-nums'],
  },
  harvestGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  harvestCell: { width: 84, gap: 4 },
  harvestPhoto: { width: 84, height: 84, borderRadius: 10, backgroundColor: Colors.surfaceInput },
  harvestPhotoEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.harvestSoft,
  },
  harvestCaption: {
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  detailedButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  detailedText: { fontSize: Typography.size.sm, color: Colors.accent },
  logSection: { gap: 10 },
  emptyLog: { fontSize: Typography.size.sm, color: Colors.inkDim },
  logRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.line,
  },
  logDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.accent,
    marginTop: 6,
  },
  logBody: { flex: 1, gap: 6 },
  logKind: {
    fontSize: Typography.size.base,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  logNote: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 19 },
  logPhotos: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  logPhoto: { width: 44, height: 44, borderRadius: 6, backgroundColor: Colors.surfaceInput },
  logPhotoMore: { fontSize: Typography.size.xs, color: Colors.inkDim },
  logDate: { fontSize: Typography.size.xs, color: Colors.inkDim },
  noteText: { fontSize: Typography.size.base, color: Colors.ink, lineHeight: 22 },
  actions: { gap: 10, marginTop: 8 },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    backgroundColor: Colors.accentSoft,
    borderWidth: 1,
    borderColor: Colors.accentLine,
  },
  secondaryText: {
    fontSize: Typography.size.base,
    color: Colors.accentInk,
    fontWeight: Typography.weight.medium,
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.dangerLine,
  },
  deleteText: { fontSize: Typography.size.base, color: Colors.danger },
  sheetHint: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 12 },
  sheetOption: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.line,
  },
  sheetOptionText: { fontSize: Typography.size.base, color: Colors.ink },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  missingText: { fontSize: Typography.size.base, color: Colors.inkDim },
  missingButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Colors.accentSoft,
  },
  missingButtonText: { fontSize: Typography.size.base, color: Colors.accentInk },
});
