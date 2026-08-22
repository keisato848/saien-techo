/**
 * S: AI 相談（R14/R15 / WBS 3.10・3.11）
 *
 * 栽培の写真（+ 症状の説明）から、品種の推定・原因候補・一般的な対処を返す。
 * 推論はだいどこ Railway 共用サーバーの /api/v1/garden/consult（決定⑨）。
 *
 * 設計の決めごと:
 * - 写真は**保存しない**。一時ファイルのまま縮小して送るだけ（相談 ≠ 記録）。
 *   記録に残したければ作業ログ（写真つき）を使う — 導線は結果画面の下に置く。
 * - 無料枠は usage.service を共有（既定 1 回/日・ビルド時変更可）。
 *   **植物が写っていない判定（isPlant=false）は枠を消費しない** — 撮り損じで
 *   1 日 1 回の枠が飛ぶのは理不尽（だいどこの not_a_dish と同じ扱い）。
 * - 免責（Q5）は結果の有無に関係なく常に画面下部に出す。
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Camera, ChevronLeft, ImageIcon, PlayCircle, Sparkles, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormField } from '../../../../src/components/FormField';
import { KeyboardAvoider } from '../../../../src/components/KeyboardAvoider';
import { PressableScale } from '../../../../src/components/PressableScale';
import { Colors, Typography } from '../../../../src/constants/theme';
import { expoImagePickerPhotoCaptureAdapter } from '../../../../src/services/expo-photo-capture.adapter';
import {
  CONFIDENCE_LABEL,
  CONSULT_DISCLAIMER,
  consultGarden,
  GardenConsultError,
  HEALTH_STATUS_LABEL,
  type GardenConsultResult,
} from '../../../../src/services/garden-consult.service';
import {
  capturePhoto,
  type PhotoCaptureSource,
} from '../../../../src/services/photo-capture.service';
import { getAdRewardProvider } from '../../../../src/services/ad-reward.service';
import { getPlantingDetail } from '../../../../src/services/planting.service';
import type { PlantingDetail } from '../../../../src/services/types';
import {
  getFreemiumStatus,
  grantAdBonus,
  recordCloudInference,
  type FreemiumStatus,
} from '../../../../src/services/usage.service';

export default function GardenConsultScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [planting, setPlanting] = useState<PlantingDetail | null>(null);
  const [status, setStatus] = useState<FreemiumStatus | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [consulting, setConsulting] = useState(false);
  const [watchingAd, setWatchingAd] = useState(false);
  const [result, setResult] = useState<GardenConsultResult | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPlanting(await getPlantingDetail(id));
    setStatus(await getFreemiumStatus());
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const handlePick = useCallback(async (source: PhotoCaptureSource) => {
    try {
      const photo = await capturePhoto(source, expoImagePickerPhotoCaptureAdapter);
      setImageUri(photo.localPath);
      setResult(null);
      setErrorText(null);
    } catch {
      // キャンセルは現状維持
    }
  }, []);

  const canConsult = Boolean(imageUri) && Boolean(status?.canInfer) && !consulting;

  const handleConsult = useCallback(async () => {
    if (!imageUri || consulting) return;
    setConsulting(true);
    setErrorText(null);
    setResult(null);
    try {
      const data = await consultGarden({
        imageUri,
        ...(planting?.cropName ? { cropName: planting.cropName } : {}),
        question,
      });
      setResult(data);
      if (data.isPlant) {
        // 成功した推論だけ枠を消費（サーバーの応答が返ってから数える）
        await recordCloudInference();
        setStatus(await getFreemiumStatus());
      }
    } catch (err) {
      setErrorText(
        err instanceof GardenConsultError
          ? err.message
          : '診断に失敗しました。時間をおいてお試しください。',
      );
    } finally {
      setConsulting(false);
    }
  }, [imageUri, consulting, planting?.cropName, question]);

  /**
   * 枠切れの利用者が動画リワードで +1 回を得る（R14 の広告ボーナス・1 日 3 回まで）。
   * 付与は**視聴完了（rewarded=true）のときだけ**。途中で閉じたら何も変えない。
   */
  const handleWatchAd = useCallback(async () => {
    if (watchingAd) return;
    setWatchingAd(true);
    setErrorText(null);
    try {
      const outcome = await getAdRewardProvider().showRewardedAd();
      if (outcome.rewarded) {
        await grantAdBonus();
        setStatus(await getFreemiumStatus());
      }
    } catch {
      setErrorText('広告を読み込めませんでした。時間をおいてお試しください。');
    } finally {
      setWatchingAd(false);
    }
  }, [watchingAd]);

  const quotaExhausted = status !== null && !status.canInfer;

  return (
    <KeyboardAvoider style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="戻る">
          <ChevronLeft size={24} color={Colors.ink} />
        </Pressable>
        <Text style={styles.headerTitle}>AI 相談</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {planting ? (
          <Text style={styles.contextLine}>
            {planting.cropName}
            {planting.variety ? `（${planting.variety}）` : ''} ・ {planting.elapsedDays}日目
          </Text>
        ) : null}

        {/* 写真（必須）。一時ファイルのまま送る — この画面では保存しない */}
        <View style={styles.group}>
          <Text style={styles.groupLabel}>気になるところの写真</Text>
          {imageUri ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
              <Pressable
                style={styles.removeBadge}
                onPress={() => {
                  setImageUri(null);
                  setResult(null);
                }}
                hitSlop={8}
                accessibilityLabel="写真を削除"
              >
                <X size={14} color={Colors.surface} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.pickRow}>
            <PressableScale
              style={styles.pickButton}
              onPress={() => void handlePick('camera')}
              accessibilityLabel="写真を撮影"
            >
              <Camera size={15} color={Colors.accentInk} />
              <Text style={styles.pickButtonText}>{imageUri ? '撮り直す' : '撮影'}</Text>
            </PressableScale>
            <PressableScale
              style={styles.pickButton}
              onPress={() => void handlePick('gallery')}
              accessibilityLabel="ギャラリーから選ぶ"
            >
              <ImageIcon size={15} color={Colors.accentInk} />
              <Text style={styles.pickButtonText}>ギャラリー</Text>
            </PressableScale>
          </View>
        </View>

        <FormField
          label="相談したいこと（任意）"
          value={question}
          onChangeText={setQuestion}
          placeholder="例: 下葉が黄色くなってきた"
          multiline
          numberOfLines={3}
          maxLength={1000}
          style={styles.questionInput}
        />

        {/* 無料枠。使い切りは submit を殺し、広告が出せるなら +1 回の導線を添える */}
        {quotaExhausted ? (
          <View style={styles.quotaCard}>
            {/*
              「また明日」と言えるのは**その日のボーナス上限に当たったとき**だけ。
              無料ぶんは生涯 1 回なので、広告が出せないだけのときに明日を約束すると嘘になる
              （明日も残数は 0 のまま）。広告が出せない状態は珍しくない —
              未読み込み・在庫なし・オフライン・広告無効ビルドのすべてで `adAvailable` は false。
            */}
            <Text style={styles.quotaText}>
              {status?.canWatchAdForMore
                ? '無料の相談は使い切りました。短い動画を見ると、もう 1 回相談できます。'
                : status && status.adBonusGranted >= status.adBonusLimit
                  ? '今日の相談はここまでです。また明日お試しください。'
                  : '無料の相談は使い切りました。いまは動画を読み込めません。時間をおいてお試しください。'}
            </Text>
            {status?.canWatchAdForMore ? (
              <PressableScale
                style={styles.watchAdButton}
                onPress={() => void handleWatchAd()}
                disabled={watchingAd}
                accessibilityLabel="動画を見てもう1回相談する"
              >
                {watchingAd ? (
                  <ActivityIndicator color={Colors.accentInk} size="small" />
                ) : (
                  <PlayCircle size={16} color={Colors.accentInk} />
                )}
                <Text style={styles.watchAdText}>
                  {watchingAd ? '広告を読み込み中…' : '動画を見てもう 1 回相談する'}
                </Text>
              </PressableScale>
            ) : null}
          </View>
        ) : status && Number.isFinite(status.remaining) ? (
          // 無料ぶんは生涯 1 回なので「今日は」と言わない（明日戻ると誤解させる）
          <Text style={styles.quotaLine}>
            {status.hasFreeLeft
              ? '最初の 1 回は無料で相談できます'
              : `今日はあと ${status.remaining} 回相談できます`}
          </Text>
        ) : null}

        <PressableScale
          style={[styles.consultButton, !canConsult && styles.consultButtonDisabled]}
          onPress={() => void handleConsult()}
          disabled={!canConsult}
          accessibilityLabel="AI に相談する"
        >
          {consulting ? (
            <ActivityIndicator color={Colors.onAccent} size="small" />
          ) : (
            <Sparkles size={16} color={Colors.onAccent} />
          )}
          <Text style={styles.consultButtonText}>{consulting ? '診断中…' : 'AI に相談する'}</Text>
        </PressableScale>

        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}

        {result && !result.isPlant ? (
          <View style={styles.resultCard}>
            <Text style={styles.notPlantText}>
              植物が写っていないようです。株の気になる部分が写るように撮り直してください。
              （この回は回数を消費していません）
            </Text>
          </View>
        ) : null}

        {result?.isPlant ? (
          <View style={styles.resultCard} testID="consult-result">
            {result.plantGuess ? (
              <View style={styles.resultSection}>
                <Text style={styles.resultLabel}>品種の推定</Text>
                <View style={styles.resultRow}>
                  <Text style={styles.resultMain}>{result.plantGuess}</Text>
                  {result.plantConfidence ? (
                    <Text style={styles.likelihoodChip}>
                      {CONFIDENCE_LABEL[result.plantConfidence]}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {result.healthStatus ? (
              <View style={styles.resultSection}>
                <Text style={styles.resultLabel}>株の状態</Text>
                <Text style={styles.resultMain}>{HEALTH_STATUS_LABEL[result.healthStatus]}</Text>
              </View>
            ) : null}

            {result.issues && result.issues.length > 0 ? (
              <View style={styles.resultSection}>
                <Text style={styles.resultLabel}>考えられる原因</Text>
                {result.issues.map((issue) => (
                  <View key={issue.name} style={styles.issueRow}>
                    <View style={styles.resultRow}>
                      <Text style={styles.issueName}>{issue.name}</Text>
                      {issue.likelihood ? (
                        <Text style={styles.likelihoodChip}>
                          {CONFIDENCE_LABEL[issue.likelihood]}
                        </Text>
                      ) : null}
                    </View>
                    {issue.signs ? <Text style={styles.issueSigns}>{issue.signs}</Text> : null}
                  </View>
                ))}
              </View>
            ) : null}

            {result.advice && result.advice.length > 0 ? (
              <View style={styles.resultSection}>
                <Text style={styles.resultLabel}>できること</Text>
                {result.advice.map((line) => (
                  <Text key={line} style={styles.bullet}>
                    ・{line}
                  </Text>
                ))}
              </View>
            ) : null}

            {result.checkPoints && result.checkPoints.length > 0 ? (
              <View style={styles.resultSection}>
                <Text style={styles.resultLabel}>確認するとよい点</Text>
                {result.checkPoints.map((line) => (
                  <Text key={line} style={styles.bullet}>
                    ・{line}
                  </Text>
                ))}
              </View>
            ) : null}

            {/* 相談は保存されない。残したい人向けに作業ログへの導線を置く */}
            <PressableScale
              style={styles.logLink}
              onPress={() => router.push(`/plantings/${id}/care-logs/new`)}
              accessibilityLabel="作業ログに記録する"
            >
              <Text style={styles.logLinkText}>この内容を作業ログに記録する</Text>
            </PressableScale>
          </View>
        ) : null}

        <Text style={styles.disclaimer}>{CONSULT_DISCLAIMER}</Text>
      </ScrollView>
    </KeyboardAvoider>
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
    borderBottomWidth: 1,
    borderBottomColor: Colors.line,
  },
  headerTitle: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.medium,
    color: Colors.ink,
  },
  headerSpacer: { width: 24 },
  body: { padding: 16, paddingBottom: 48 },
  contextLine: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 14 },
  group: { marginBottom: 16 },
  groupLabel: { fontSize: Typography.size.sm, color: Colors.inkDim, marginBottom: 8 },
  previewWrap: { position: 'relative', marginBottom: 8 },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 10,
    backgroundColor: Colors.surfaceInput,
  },
  removeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
  },
  pickButtonText: { fontSize: Typography.size.sm, color: Colors.accentInk },
  questionInput: { minHeight: 84, textAlignVertical: 'top' },
  quotaLine: { fontSize: Typography.size.xs, color: Colors.inkDim, marginBottom: 10 },
  quotaCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  quotaText: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 20 },
  watchAdButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.accentLine,
    backgroundColor: Colors.accentSoft,
    paddingVertical: 10,
  },
  watchAdText: {
    fontSize: Typography.size.sm,
    color: Colors.accentInk,
    fontWeight: Typography.weight.medium,
  },
  consultButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: Colors.accent,
    paddingVertical: 14,
  },
  consultButtonDisabled: { opacity: 0.45 },
  consultButtonText: {
    fontSize: Typography.size.md,
    fontWeight: Typography.weight.semibold,
    color: Colors.onAccent,
  },
  errorText: {
    marginTop: 12,
    fontSize: Typography.size.sm,
    color: Colors.danger,
    lineHeight: 20,
  },
  resultCard: {
    marginTop: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.line,
    backgroundColor: Colors.surface,
    padding: 14,
    gap: 14,
  },
  notPlantText: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 20 },
  resultSection: { gap: 6 },
  resultLabel: {
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    fontWeight: Typography.weight.medium,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  resultMain: { fontSize: Typography.size.md, color: Colors.ink },
  likelihoodChip: {
    fontSize: Typography.size.xs,
    color: Colors.accentInk,
    backgroundColor: Colors.accentSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  issueRow: { gap: 2, marginBottom: 4 },
  issueName: { fontSize: Typography.size.md, color: Colors.ink },
  issueSigns: { fontSize: Typography.size.sm, color: Colors.inkDim, lineHeight: 19 },
  bullet: { fontSize: Typography.size.sm, color: Colors.ink, lineHeight: 21 },
  logLink: { alignSelf: 'flex-start' },
  logLinkText: {
    fontSize: Typography.size.sm,
    color: Colors.accent,
    fontWeight: Typography.weight.medium,
  },
  disclaimer: {
    marginTop: 20,
    fontSize: Typography.size.xs,
    color: Colors.inkDim,
    lineHeight: 18,
  },
});
