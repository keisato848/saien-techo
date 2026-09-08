/**
 * 作業ログの記録（写真・メモ付き）— R04 / WBS 1.8
 *
 * 「つぎの作業」（R10 / WBS 3.4）や「今日のリマインダー」（R11 / WBS 3.5）から
 * 来たときは ?kind= で作業種別を選択済みにして開く（追肥の提案から開いたのに
 * 水やりが選ばれていると、そのまま記録して履歴が濁る）。
 *
 * **?task= は栽培暦の作業そのもの**（v16 / 4.19 レビュー 6）。kind は 6 語彙しか無く、
 * 支柱・土寄せ・間引き・防虫ネットが揃って `other` になるため、
 * 「土寄せを記録する」で開いてもタイムラインに「その他」としか残らなかった。
 * 知らない値は捨てる（?kind= と同じ扱い — 手で URL を作られても壊れないように）。
 * ?note= はガイドの一言（「本葉 5〜6 枚で」）をメモの下書きとして渡す。
 *
 * **CareLogForm に key を渡して種別ごとに作り直す。** この画面は 2 回目以降の
 * 遷移で再マウントされず、CareLogForm の useState が前回の値を持ち越す。
 * key が無いと「水やりの行を開く → 戻る → 剪定の行を開く」で水やりのまま開き、
 * 利用者は気づかずに違う作業を記録してしまう（実機で再現）。
 *
 * **残っている穴（既知・未対応）**: 同じ種別で続けて 2 回開くと key が変わらず、
 * 前回の日付・メモ・写真が残る。記録前に画面で見えるうえ既存データは壊れないので
 * 放置している。事情は reminders/new.tsx のコメント参照。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';

import { CareLogForm, type CareLogFormValues } from '../../../../../src/components/CareLogForm';
import { CROP_TASK_LABEL, type CropTaskKind } from '../../../../../src/db/crop-master';
import { CARE_KINDS, createCareLog } from '../../../../../src/services/care-log.service';
import type { CareLogKind } from '../../../../../src/services/types';

export default function NewCareLogScreen() {
  const { id, kind, task, note } = useLocalSearchParams<{
    id: string;
    kind?: string;
    task?: string;
    note?: string;
  }>();
  const router = useRouter();

  const initialKind =
    kind && (CARE_KINDS as readonly string[]).includes(kind) ? (kind as CareLogKind) : undefined;
  const taskKind =
    task && Object.prototype.hasOwnProperty.call(CROP_TASK_LABEL, task)
      ? (task as CropTaskKind)
      : undefined;

  const handleSubmit = useCallback(
    async (values: CareLogFormValues) => {
      await createCareLog({
        plantingId: id,
        kind: values.kind,
        taskKind: taskKind ?? null,
        loggedAt: values.loggedAt,
        note: values.note,
        photoUris: values.photoUris,
      });
      router.back();
    },
    [id, router, taskKind],
  );

  return (
    <CareLogForm
      // 作業まで鍵に入れる。「土寄せ → 戻る → 間引き」はどちらも kind=other なので、
      // 鍵が kind だけだと作り直されず、前の作業のまま記録される
      key={`${id}-${initialKind ?? ''}-${taskKind ?? ''}`}
      initialValues={
        initialKind || note ? { ...(initialKind ? { kind: initialKind } : {}), note } : undefined
      }
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      title={taskKind ? `${CROP_TASK_LABEL[taskKind]}を記録` : '作業を記録'}
      submitLabel="記録"
    />
  );
}
