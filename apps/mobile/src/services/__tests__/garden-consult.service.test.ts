/**
 * AI 相談サービス（R14/R15 / WBS 3.10・3.11）。
 *
 * 見るのは**サーバーへ渡る引数**と**エラーの種別**。
 * fetch と画像アダプタを注入し、ネットワークにも expo にも触れない。
 */
import {
  CONSULT_DISCLAIMER,
  consultGarden,
  GardenConsultError,
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
