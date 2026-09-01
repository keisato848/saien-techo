/**
 * 写真から栽培をまとめて登録する（WBS 4.15 / #139・一括は #149）。
 *
 * 庭を何枚か撮る → 作物ごとの下書きが並ぶ → 直して一括登録。
 * インストール直後は何も登録されていないので、ここが最初の入口になる。
 *
 * ## 撮るものは 2 種類あって、どちらでもよい
 *
 * - **苗のラベル・種袋** … 品種（アイコ・桃太郎）まで埋まる。ユーザーが打てない値（#139）
 * - **育っている株** … 作物名が埋まる。品種は写真から決まらないので空のまま
 *
 * どちらを撮ったかはサーバーが判定するので、ユーザーにモードを選ばせない。
 *
 * ## 通行権はリワードだけ（ユーザー判断・2026-08-22）
 *
 * 相談・収穫の無料枠（生涯 1 回）とは**混ぜない**。混ぜると初回の一括登録で
 * 使い切って相談を一度も試せなくなる。ここは `identify-credit.service` の残高だけを使う。
 *
 * **写真が無くても手で登録できる**（#139 の共通の作法）。読み取りは近道であって必須にしない。
 *
 * ## ボタンの並びは残高 0 のときだけ入れ替える（実機で利用者が詰まった・2026-09-01）
 *
 * 残高 0 の利用者が主要ボタン「写真を選ぶ」を自然に先に押し、選んだ写真が全部
 * `pending`（読み取り待ち）のまま先に進めなくなった実績がある。`identifyPhotoBatch`
 * の不変条件（残高が無ければ 1 枚も送らない）は直さず、残高 0 のときだけ
 * 「動画を見て読み取る」ボタンを先に出す（`primaryButton`/`rewardButton` の並び替え）。
 *
 * ## 植え付け日・場所も写真から埋める（方針転換・2026-09-02・実機フィードバック）
 *
 * 「作物名しか取れないなら使い道がない」という実機からの指摘（利用者）を受けて、
 * 撮影日（EXIF）とサーバーの生育ステージ推定（`estimatedAgeDays`）を使って
 * 植え付け日の初期値を出す（`planting-draft.service.ts` の `estimatePlantedOn`）。
 * 場所は、登録済みが 1 件だけなら自動適用、複数あれば**下書きごとではなく一括で**
 * 選ばせる（下書きごとに選ばせると一括登録の価値が薄れる — #149 と同じ理由）。
 * どちらも必ず直せるままにする（#139 の共通の作法）。
 */
import { useFocusEffect, useRouter } from 'expo-router';
import { Camera, ChevronLeft, PlayCircle, Sparkles } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DateField } from '../../../src/components/DateField';
import { EmptyState } from '../../../src/components/EmptyState';
import { FormField } from '../../../src/components/FormField';
import { KeyboardAvoider } from '../../../src/components/KeyboardAvoider';
import { PressableScale } from '../../../src/components/PressableScale';
import { Toast } from '../../../src/components/Toast';
import { Colors, Typography } from '../../../src/constants/theme';
import { getAdRewardProvider, isAdRewardAvailable } from '../../../src/services/ad-reward.service';
import {
  getIdentifyCredits,
  grantIdentifyCredits,
  IDENTIFY_PER_REWARD,
} from '../../../src/services/identify-credit.service';
import { expoImagePickerPhotoCaptureAdapter } from '../../../src/services/expo-photo-capture.adapter';
import {
  capturePhotos,
  PhotoCaptureCancelledError,
  type CapturedPhoto,
} from '../../../src/services/photo-capture.service';
import { getPlaceList } from '../../../src/services/place.service';
import { persistGardenPhotos } from '../../../src/services/photo-storage.service';
import { createPlanting } from '../../../src/services/planting.service';
import {
  estimatePlantedOn,
  identifyPhotoBatch,
  MAX_IDENTIFY_BATCH,
  registrableDrafts,
  type PlantingDraft,
} from '../../../src/services/planting-draft.service';
import type { PlaceItem } from '../../../src/services/types';

/** 登録日の既定は今日。PlantingForm と同じ作法（あとから編集できる） */
function todayIso(): string {
  return new Date().toISOString();
}

/**
 * 下書きに植え付け日の既定値を付ける。
 *
 * 対象は state を問わない — `pending`/`failed` でも、あとから作物名だけ
 * 手で入れて登録できる（registrableDrafts の作法）ので、植え付け日も
 * 先に埋めておく。撮影日が拾えない（写真が photosByUri に無い）ときは
 * 今日を渡す — estimatePlantedOn 自身が未来日/破損値をガードする。
 */
function applyPlantedOnDefaults(
  drafts: PlantingDraft[],
  photos: Pick<CapturedPhoto, 'localPath' | 'takenAt'>[],
): PlantingDraft[] {
  const takenAtByUri = new Map(photos.map((photo) => [photo.localPath, photo.takenAt]));
  return drafts.map((draft) => {
    const takenAt = takenAtByUri.get(draft.imageUri) ?? todayIso();
    const estimate = estimatePlantedOn(draft, takenAt);
    return { ...draft, plantedOn: estimate.plantedOn, plantedOnReason: estimate.reason };
  });
}

export default function IdentifyPlantingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [drafts, setDrafts] = useState<PlantingDraft[]>([]);
  const [credits, setCredits] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState<string | null>(null);
  const [watchingAd, setWatchingAd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  // 撮影した写真の実体（takenAt・保存用の CapturedPhoto）。imageUri で引く。
  // カバー写真の保存（handleSaveAll）と、pending を後で読み取ったときの
  // plantedOn 再計算（handleProcessPending）の両方に要る
  const [photosByUri, setPhotosByUri] = useState<Record<string, CapturedPhoto>>({});
  const [places, setPlaces] = useState<PlaceItem[]>([]);
  // 場所が複数あるときだけ使う一括選択（下書きごとには選ばせない）
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const runningRef = useRef(false);

  const loadCredits = useCallback(async () => {
    setCredits(await getIdentifyCredits());
  }, []);

  const loadPlaces = useCallback(async () => {
    setPlaces(await getPlaceList());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadCredits();
      void loadPlaces();
    }, [loadCredits, loadPlaces]),
  );

  // 場所が 1 件だけなら自動でそれを使う。複数あるときだけ selectedPlaceId を使う
  const effectivePlaceId = places.length === 1 ? places[0].id : selectedPlaceId;

  /** 写真を選んで読み取る。残高のぶんだけ送る（残りは pending で残す） */
  const handlePick = useCallback(async () => {
    if (runningRef.current) return;
    setMessage(null);
    let photos: CapturedPhoto[];
    let uris: string[];
    try {
      photos = await capturePhotos(MAX_IDENTIFY_BATCH, expoImagePickerPhotoCaptureAdapter);
      uris = photos.map((photo) => photo.localPath);
    } catch (err) {
      if (!(err instanceof PhotoCaptureCancelledError)) {
        setMessage('写真を選べませんでした。');
      }
      return;
    }

    // カバー写真の保存・plantedOn の再計算に要るので取っておく（撮り直すまで残す）
    setPhotosByUri((current) => {
      const next = { ...current };
      for (const photo of photos) next[photo.localPath] = photo;
      return next;
    });

    runningRef.current = true;
    setProcessing(true);
    setProgressText(`0 / ${uris.length} 枚`);
    try {
      const result = await identifyPhotoBatch(uris, (progress) => {
        setProgressText(`${progress.done} / ${progress.total} 枚`);
      });
      setDrafts(applyPlantedOnDefaults(result, photos));
      const pending = result.filter((draft) => draft.state === 'pending').length;
      if (pending > 0) {
        setMessage(
          `残り ${pending} 枚は動画を見ると読み取れます。作物名を入力すれば、その写真だけ先に登録できます。`,
        );
      }
    } finally {
      runningRef.current = false;
      setProcessing(false);
      setProgressText(null);
      await loadCredits();
    }
  }, [loadCredits]);

  /** 未読み取りぶんを、残高を足してから読み直す */
  const handleProcessPending = useCallback(async () => {
    const pendingUris = drafts
      .filter((draft) => draft.state === 'pending')
      .map((draft) => draft.imageUri);
    if (pendingUris.length === 0 || runningRef.current) return;

    runningRef.current = true;
    setProcessing(true);
    try {
      const processed = await identifyPhotoBatch(pendingUris, (progress) => {
        setProgressText(`${progress.done} / ${progress.total} 枚`);
      });
      // pending だった時点で photosByUri には既に入っている（handlePick で撮った写真）
      const withPlantedOn = applyPlantedOnDefaults(processed, Object.values(photosByUri));
      const byUri = new Map(withPlantedOn.map((draft) => [draft.imageUri, draft]));
      setDrafts((current) => current.map((draft) => byUri.get(draft.imageUri) ?? draft));
    } finally {
      runningRef.current = false;
      setProcessing(false);
      setProgressText(null);
      await loadCredits();
    }
  }, [drafts, loadCredits, photosByUri]);

  const handleWatchAd = useCallback(async () => {
    setMessage(null);
    setWatchingAd(true);
    try {
      const outcome = await getAdRewardProvider().showRewardedAd();
      // **視聴完了のときだけ**残高を足す（#143 の不変条件と同じ）
      if (!outcome.rewarded) {
        setMessage('動画が最後まで再生されませんでした。もう一度お試しください。');
        return;
      }
      await grantIdentifyCredits();
      await loadCredits();
      // 待っている写真があるなら、続けて読み取ってしまう（ここで止めない）
      await handleProcessPending();
    } catch {
      setMessage('広告を読み込めませんでした。時間をおいてお試しください。');
    } finally {
      setWatchingAd(false);
    }
  }, [handleProcessPending, loadCredits]);

  const updateDraft = useCallback((imageUri: string, patch: Partial<PlantingDraft>) => {
    setDrafts((current) =>
      current.map((draft) => (draft.imageUri === imageUri ? { ...draft, ...patch } : draft)),
    );
  }, []);

  const removeDraft = useCallback((imageUri: string) => {
    setDrafts((current) => current.filter((draft) => draft.imageUri !== imageUri));
  }, []);

  /**
   * 確認した下書きをまとめて登録する。
   *
   * **カバー写真は保存する（方針転換・2026-09-02）。** 以前はここに「写真は保存しない
   * （#149 のバックアップ問題を作らない）」と書いていたが、#149 が問題にしたのは
   * 毎日の記録写真（作業ログ・収穫で年 1800 枚・360〜720MB）の話で、登録の
   * カバー写真は 1 件につき 1 枚（年数十枚）と桁が違う。保存は persistGardenPhotos に
   * 任せ、失敗しても登録自体は止めない（fail-open — 写真が理由で栽培が
   * 登録できないのは行き止まりになる）。
   */
  const handleSaveAll = useCallback(async () => {
    const targets = registrableDrafts(drafts);
    if (targets.length === 0) return;
    setSaving(true);
    try {
      for (const draft of targets) {
        const cropName = draft.cropName?.trim();
        // registrableDrafts が空を弾いているが、型の上でも詰める
        if (!cropName) continue;

        const sourcePhoto = photosByUri[draft.imageUri];
        let coverPhotoPath: string | null = null;
        if (sourcePhoto) {
          try {
            const [saved] = await persistGardenPhotos([sourcePhoto]);
            coverPhotoPath = saved ?? null;
          } catch {
            // fail-open: 写真が保存できないだけで登録を止めない
            coverPhotoPath = null;
          }
        }

        await createPlanting({
          cropName,
          cropNameReading: draft.cropNameReading ?? undefined,
          cropId: draft.cropId ?? null,
          variety: draft.variety || undefined,
          placeId: effectivePlaceId,
          plantedOn: draft.plantedOn ?? todayIso(),
          plantedAs: draft.plantedAs ?? 'seedling',
          coverPhotoPath,
          tags: [],
        });
      }
      setSavedCount(targets.length);
      setTimeout(() => router.replace('/plantings'), 900);
    } catch {
      setMessage('登録に失敗しました。もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  }, [drafts, effectivePlaceId, photosByUri, router]);

  const readyCount = registrableDrafts(drafts).length;
  const pendingCount = drafts.filter((draft) => draft.state === 'pending').length;
  const canWatchAd = isAdRewardAvailable() && !watchingAd && !processing;

  const primaryButton = !processing ? (
    <PressableScale
      style={styles.primaryButton}
      onPress={() => void handlePick()}
      accessibilityLabel="写真を選ぶ"
    >
      <Camera size={16} color={Colors.onAccent} />
      <Text style={styles.primaryButtonText}>写真を選ぶ</Text>
    </PressableScale>
  ) : null;

  // 残高が無い、または待っている写真があるときだけ動画を勧める
  const rewardButton =
    canWatchAd && (credits === 0 || pendingCount > 0) ? (
      <PressableScale
        style={styles.rewardButton}
        onPress={() => void handleWatchAd()}
        disabled={watchingAd}
        accessibilityLabel={`動画を見て ${IDENTIFY_PER_REWARD} 枚を読み取る`}
      >
        {watchingAd ? (
          <ActivityIndicator color={Colors.accentInk} size="small" />
        ) : (
          <PlayCircle size={16} color={Colors.accentInk} />
        )}
        <Text style={styles.rewardButtonText}>
          {watchingAd ? '広告を読み込み中…' : `動画を見て ${IDENTIFY_PER_REWARD} 枚を読み取る`}
        </Text>
      </PressableScale>
    ) : null;

  return (
    // 入力欄（作物名・品種）の下に「登録する」が来る＝#134 と同じ形なので必ず包む
    <KeyboardAvoider style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <PressableScale onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={24} color={Colors.ink} />
        </PressableScale>
        <Text style={styles.headerTitle}>写真から栽培を登録</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {drafts.length === 0 ? (
          <EmptyState
            icon="🌱"
            title="育てているものを撮って登録"
            message={`苗のラベルや種袋を撮ると品種まで、育っている株を撮ると作物名が入ります。最大 ${MAX_IDENTIFY_BATCH} 枚までまとめて選べます。`}
          />
        ) : null}

        <Text style={styles.caption}>
          {credits > 0
            ? `あと ${credits} 枚 読み取れます`
            : `動画を 1 本見ると ${IDENTIFY_PER_REWARD} 枚 読み取れます`}
        </Text>

        {/*
          残高 0 で「写真を選ぶ」を先に押すと、選んだ分が全部 pending のまま
          進めなくなった実績があるため、残高 0 のときだけ動画ボタンを先に出す
          （ファイル冒頭の doc コメント参照・2026-09-01）。credits > 0 なら現状どおり
          「写真を選ぶ」が先。
        */}
        {credits === 0 ? (
          <>
            {rewardButton}
            {primaryButton}
          </>
        ) : (
          <>
            {primaryButton}
            {rewardButton}
          </>
        )}

        {progressText ? (
          <View style={styles.progressRow}>
            <ActivityIndicator size="small" color={Colors.accentInk} />
            <Text style={styles.progressText}>{progressText}</Text>
          </View>
        ) : null}
        {message ? <Text style={styles.message}>{message}</Text> : null}

        {/*
          場所が複数あるときだけ、全下書きへ一括で適用する 1 つの選択 UI を出す。
          1 件しかなければ自動適用（effectivePlaceId）、0 件なら出さない。
          下書きごとに選ばせないのは、一括登録のタップ数の少なさが価値だから（#149）。
        */}
        {drafts.length > 0 && places.length > 1 ? (
          <View style={styles.group}>
            <Text style={styles.groupLabel}>場所（すべての下書きに適用）</Text>
            <View style={styles.chips}>
              <PressableScale
                style={[styles.chip, selectedPlaceId == null && styles.chipActive]}
                onPress={() => setSelectedPlaceId(null)}
                accessibilityLabel="場所を未設定にする"
              >
                <Text style={[styles.chipText, selectedPlaceId == null && styles.chipTextActive]}>
                  未設定
                </Text>
              </PressableScale>
              {places.map((place) => {
                const active = selectedPlaceId === place.id;
                return (
                  <PressableScale
                    key={place.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setSelectedPlaceId(place.id)}
                    accessibilityLabel={`場所を${place.name}にする`}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {place.name}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </View>
        ) : null}

        {drafts.map((draft) => (
          <DraftRow
            key={draft.imageUri}
            draft={draft}
            onChange={(patch) => updateDraft(draft.imageUri, patch)}
            onRemove={() => removeDraft(draft.imageUri)}
          />
        ))}

        {readyCount > 0 ? (
          <PressableScale
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={() => void handleSaveAll()}
            disabled={saving}
            accessibilityLabel={`${readyCount} 件を登録する`}
          >
            {saving ? (
              <ActivityIndicator color={Colors.onAccent} size="small" />
            ) : (
              <Sparkles size={16} color={Colors.onAccent} />
            )}
            <Text style={styles.saveButtonText}>
              {saving ? '登録中…' : `${readyCount} 件を登録する`}
            </Text>
          </PressableScale>
        ) : null}

        {/* 写真が使えなくても行き止まりにしない（#139 の共通の作法） */}
        <PressableScale
          style={styles.manualLink}
          onPress={() => router.replace('/plantings/new')}
          accessibilityLabel="手で入力して登録する"
        >
          <Text style={styles.manualLinkText}>手で入力して登録する →</Text>
        </PressableScale>
      </ScrollView>

      <Toast
        message={`${savedCount} 件の栽培を登録しました`}
        visible={savedCount > 0}
        onDismiss={() => setSavedCount(0)}
      />
    </KeyboardAvoider>
  );
}

function DraftRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: PlantingDraft;
  onChange: (patch: Partial<PlantingDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Image source={{ uri: draft.imageUri }} style={styles.thumb} />
        <View style={styles.cardInfo}>
          {draft.state === 'pending' ? (
            <Text style={styles.stateText}>読み取り待ち</Text>
          ) : draft.state === 'failed' ? (
            <Text style={styles.errorText}>{draft.errorMessage}</Text>
          ) : (
            <Text style={styles.stateText}>
              {draft.source === 'label' ? 'ラベルから読み取り' : '株から推定'}
              {draft.confidence === 'low' ? '（自信が低めです）' : ''}
            </Text>
          )}
          {draft.note ? <Text style={styles.noteText}>{draft.note}</Text> : null}
        </View>
        <PressableScale onPress={onRemove} hitSlop={10} accessibilityLabel="この写真をやめる">
          <Text style={styles.removeText}>削除</Text>
        </PressableScale>
      </View>

      {/* 推定は必ず見せて直させる（#139 の共通の作法）。正はユーザーの確定 */}
      <FormField
        label="作物名"
        value={draft.cropName ?? ''}
        onChangeText={(text) => onChange({ cropName: text })}
        placeholder="例: ミニトマト"
      />
      <FormField
        label="品種（任意）"
        value={draft.variety ?? ''}
        onChangeText={(text) => onChange({ variety: text })}
        placeholder={draft.source === 'plant' ? '株の写真からは読み取れません' : '例: アイコ'}
      />
      {/*
        推定日は必ず見せて直させる（#139 の共通の作法）。plantedOnReason は
        estimatedAgeDays が効いたときだけ入り、「なぜこの日付か」を1行で見せる
        （利用者が的外れな推定に気づけるように）。手で直したら reason は消す —
        直した値の理由を「推定」のまま出し続けると嘘の説明になる
      */}
      <DateField
        label="植え付け日"
        value={draft.plantedOn ?? new Date().toISOString()}
        onChange={(iso) => onChange({ plantedOn: iso, plantedOnReason: undefined })}
        hint={draft.plantedOnReason}
      />
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
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.line,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerSpacer: { width: 24 },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  caption: { fontSize: Typography.size.sm, color: Colors.inkDim },
  // 場所の一括選択（PlantingForm の場所チップと同じ見た目に揃える）
  group: { gap: 8 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
  },
  chipActive: { borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  chipText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  chipTextActive: { color: Colors.accentInk, fontWeight: Typography.weight.medium },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  primaryButtonText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  rewardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  rewardButtonText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.accentInk,
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressText: { fontSize: Typography.size.sm, color: Colors.inkDim },
  message: { fontSize: Typography.size.sm, color: Colors.ink },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: Colors.line },
  cardInfo: { flex: 1, gap: 2 },
  stateText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  errorText: { fontSize: Typography.size.xs, color: Colors.danger },
  noteText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  removeText: { fontSize: Typography.size.xs, color: Colors.inkDim },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveButtonText: {
    fontSize: Typography.size.sm,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  manualLink: { alignItems: 'center', paddingVertical: 12 },
  manualLinkText: { fontSize: Typography.size.sm, color: Colors.accentInk },
});
