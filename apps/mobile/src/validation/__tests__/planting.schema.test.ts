import {
  ENDED_REASON_LABEL,
  PLANTED_AS_LABEL,
  PLANTING_ENDED_REASONS,
  plantingFormSchema,
} from '../planting.schema';

function base(overrides: Record<string, unknown> = {}) {
  return {
    cropName: 'トマト',
    plantedOn: new Date().toISOString(),
    plantedAs: 'seedling',
    tags: [],
    ...overrides,
  };
}

function daysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

describe('plantingFormSchema', () => {
  it('作物名と植え付け日だけで通る（R01 の最短登録）', () => {
    expect(plantingFormSchema.safeParse(base()).success).toBe(true);
  });

  it('作物名が空だと弾く', () => {
    const result = plantingFormSchema.safeParse(base({ cropName: '' }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('作物名は必須です');
    }
  });

  it('作物名が 30 文字を超えると弾く', () => {
    expect(plantingFormSchema.safeParse(base({ cropName: 'あ'.repeat(31) }).cropName).success).toBe(
      false,
    );
    expect(plantingFormSchema.safeParse(base({ cropName: 'あ'.repeat(30) })).success).toBe(true);
  });

  it('未来の植え付け日は弾く（予定は作付け計画 R17 の領分）', () => {
    const result = plantingFormSchema.safeParse(base({ plantedOn: daysFromNow(1) }));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toBe('未来の日付は登録できません');
    }
  });

  it('今日の日付は通る（当日いっぱいまで許可）', () => {
    const endOfToday = new Date();
    endOfToday.setHours(23, 30, 0, 0);
    expect(
      plantingFormSchema.safeParse(base({ plantedOn: endOfToday.toISOString() })).success,
    ).toBe(true);
  });

  it('過去の日付は通る（あとから記録する場合）', () => {
    expect(plantingFormSchema.safeParse(base({ plantedOn: daysFromNow(-365) })).success).toBe(true);
  });

  it('日付として解釈できない文字列は弾く', () => {
    const result = plantingFormSchema.safeParse(base({ plantedOn: 'きのう' }));
    expect(result.success).toBe(false);
  });

  it('plantedAs は種/苗のみ', () => {
    expect(plantingFormSchema.safeParse(base({ plantedAs: 'seed' })).success).toBe(true);
    expect(plantingFormSchema.safeParse(base({ plantedAs: 'graft' })).success).toBe(false);
  });

  it('場所は未指定（null）を許す', () => {
    expect(plantingFormSchema.safeParse(base({ placeId: null })).success).toBe(true);
  });

  it('メモは 1000 文字まで', () => {
    expect(plantingFormSchema.safeParse(base({ note: 'あ'.repeat(1000) })).success).toBe(true);
    expect(plantingFormSchema.safeParse(base({ note: 'あ'.repeat(1001) })).success).toBe(false);
  });
});

describe('ラベル定義', () => {
  it('終了理由すべてに表示名がある', () => {
    for (const reason of PLANTING_ENDED_REASONS) {
      expect(ENDED_REASON_LABEL[reason]).toBeTruthy();
    }
  });

  it('種/苗の表示名がある', () => {
    expect(PLANTED_AS_LABEL.seed).toBe('種から');
    expect(PLANTED_AS_LABEL.seedling).toBe('苗から');
  });
});
