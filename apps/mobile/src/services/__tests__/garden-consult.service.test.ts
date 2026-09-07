/**
 * AI 相談サービス（R14/R15 / WBS 3.10・3.11）。
 *
 * 見るのは**サーバーへ渡る引数**と**エラーの種別**。
 * fetch と画像アダプタを注入し、ネットワークにも expo にも触れない。
 */
import {
  composeConsultQuestion,
  CONSULT_DISCLAIMER,
  CONSULT_QUESTION_MAX_LENGTH,
  consultGarden,
  consultQuestionAllowance,
  GardenConsultError,
  type ConsultContextLine,
  type ConsultImageAdapter,
} from '../garden-consult.service';

const stubImageAdapter: ConsultImageAdapter = {
  prepare: async () => ({ base64: 'QUJD', mimeType: 'image/jpeg' }),
};

function okFetch(payload: unknown): typeof fetch {
  return jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('consultGarden', () => {
  it('作物名・相談文・画像を JSON で送り、data を返す', async () => {
    const fetchFn = okFetch({
      ok: true,
      data: { isPlant: true, plantGuess: 'ミニトマト', issues: [{ name: '窒素不足' }] },
    });

    const result = await consultGarden(
      { imageUri: 'file:///tmp/leaf.jpg', cropName: 'ミニトマト', question: '下葉が黄色い' },
      stubImageAdapter,
      fetchFn,
    );

    expect(result.plantGuess).toBe('ミニトマト');
    const [url, init] = (fetchFn as jest.Mock).mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/garden\/consult$/);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      imageBase64: 'QUJD',
      mimeType: 'image/jpeg',
      cropName: 'ミニトマト',
      question: '下葉が黄色い',
      locale: 'ja',
    });
  });

  it('空の相談文・作物名は送らない（サーバーの min(1) 検証に当てない）', async () => {
    const fetchFn = okFetch({ ok: true, data: { isPlant: true } });
    await consultGarden(
      { imageUri: 'file:///tmp/leaf.jpg', cropName: '  ', question: '' },
      stubImageAdapter,
      fetchFn,
    );
    const [, init] = (fetchFn as jest.Mock).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('question');
    expect(body).not.toHaveProperty('cropName');
  });

  it('ok:false はサーバーの文言と種別で GardenConsultError にする', async () => {
    const fetchFn = okFetch({
      ok: false,
      error: { code: 'RATE_LIMITED', message: '本日の利用上限に達しました。', retryable: false },
    });

    await expect(
      consultGarden({ imageUri: 'file:///x.jpg' }, stubImageAdapter, fetchFn),
    ).rejects.toMatchObject({
      name: 'GardenConsultError',
      message: '本日の利用上限に達しました。',
      retryable: false,
      kind: 'rate_limited',
    });
  });

  it('HTTP 500 は retryable なエラーにする', async () => {
    const fetchFn = jest.fn(async () => ({
      ok: false,
      status: 502,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    await expect(
      consultGarden({ imageUri: 'file:///x.jpg' }, stubImageAdapter, fetchFn),
    ).rejects.toMatchObject({ retryable: true });
  });

  it('ネットワーク断は offline 種別にする', async () => {
    const fetchFn = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(
      consultGarden({ imageUri: 'file:///x.jpg' }, stubImageAdapter, fetchFn),
    ).rejects.toMatchObject({ kind: 'offline' });
  });

  it('画像を読めないときは retryable=false（撮り直しを促す）', async () => {
    const broken: ConsultImageAdapter = {
      prepare: async () => {
        throw new Error('no file');
      },
    };
    await expect(
      consultGarden({ imageUri: 'file:///x.jpg' }, broken, okFetch({ ok: true, data: {} })),
    ).rejects.toMatchObject({ retryable: false });
  });
});

describe('免責文（Q5 / §8.4）', () => {
  it('農薬はラベル・法令に従う旨と、最終判断が利用者にある旨を含む', () => {
    // 文言の微修正は許容するが、この 2 点を消す変更は回帰として検出する
    expect(CONSULT_DISCLAIMER).toContain('製品ラベル');
    expect(CONSULT_DISCLAIMER).toContain('ご自身の責任');
  });

  it('GardenConsultError は Error として投げられる', () => {
    const err = new GardenConsultError('x', true, 'transient');
    expect(err).toBeInstanceOf(Error);
    expect(err.retryable).toBe(true);
  });
});

/**
 * 栽培の文脈は `question` に畳んで送る（WBS 4.14 / #138）。
 * サーバー（だいどこの Railway・決定⑨）の zod は知らないキーを捨てるので、
 * 新しいフィールドを増やしても届かない。
 */
describe('composeConsultQuestion', () => {
  const LINES: ConsultContextLine[] = [
    { label: '品種', value: 'アイコ' },
    { label: '経過', value: '苗から・42日目' },
  ];

  it('文脈を前に畳み、利用者の言葉は最後に置く', () => {
    expect(composeConsultQuestion(LINES, '下葉が黄色い')).toBe(
      [
        '【栽培の状況】',
        '・品種: アイコ',
        '・経過: 苗から・42日目',
        '【相談】',
        '下葉が黄色い',
      ].join('\n'),
    );
  });

  it('相談文が空でも、写真だけの診断を頼む文を置く（サーバーの分岐に合わせる）', () => {
    expect(composeConsultQuestion(LINES, '')).toContain('品種の推定と株の状態');
  });

  it('文脈が無いときは元の挙動（空なら送らない）', () => {
    expect(composeConsultQuestion([], '下葉が黄色い')).toBe('下葉が黄色い');
    expect(composeConsultQuestion(undefined, '  ')).toBeUndefined();
    expect(composeConsultQuestion([], undefined)).toBeUndefined();
  });

  it('値が空の行は落とす（「品種: 」だけの行を送らない）', () => {
    expect(composeConsultQuestion([{ label: '品種', value: ' ' }], 'あ')).toBe('あ');
  });

  it('サーバーの上限（1000 文字）を超えない', () => {
    const composed = composeConsultQuestion(LINES, 'あ'.repeat(1200)) ?? '';
    expect(composed.length).toBe(CONSULT_QUESTION_MAX_LENGTH);
  });
});

describe('consultQuestionAllowance', () => {
  it('文脈のぶんだけ入力欄の上限を縮める', () => {
    const lines: ConsultContextLine[] = [{ label: '品種', value: 'アイコ' }];
    const allowance = consultQuestionAllowance(lines);

    expect(allowance).toBeLessThan(CONSULT_QUESTION_MAX_LENGTH);
    // 上限いっぱいまで打っても、畳んだ結果がサーバーの上限に収まる
    expect((composeConsultQuestion(lines, 'あ'.repeat(allowance)) ?? '').length).toBe(
      CONSULT_QUESTION_MAX_LENGTH,
    );
  });

  it('文脈が無いときはサーバーの上限そのもの', () => {
    expect(consultQuestionAllowance([])).toBe(CONSULT_QUESTION_MAX_LENGTH);
  });
});
