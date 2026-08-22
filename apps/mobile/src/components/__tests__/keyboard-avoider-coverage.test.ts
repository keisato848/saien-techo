/**
 * 入力欄のある画面が `KeyboardAvoider` で包まれていることの横断チェック。
 *
 * `KeyboardAvoider.tsx` の冒頭には「入力欄のある画面は必ずこれで包む」と書いてあるが、
 * **規約を文章で書いただけでは守られない** — だいどこでは同じ規約がコメントにあったのに
 * 主役機能を含む 5 画面が漏れ、キーボードが下部のボタンを覆って押せない状態で出荷された
 * （daidoko#172）。さいえん手帳は移植時点で `KeyboardAvoider` 自体が無く、
 * 入力欄のある 13 ファイル（うち包む対象 9・残り 4 は下の EXEMPT）が
 * 1 つも包まれていなかった。人力の棚卸しに戻さないよう、ここで機械的に見張る。
 *
 * **だいどこ版の「`app/` を `<TextInput` で走査する」ではさいえん手帳を守れない。**
 * こちらは入力欄が `src/components/` の共通フォームに寄っていて、画面
 * （`plantings/new.tsx` など）は `<PlantingForm>` を置くだけだから、
 * `<TextInput` だけを見ると 3 ファイルしか引っかからない。そこで
 * **入力部品（`INPUT_PARTS`）を経由した間接的な入力も「入力欄あり」と数える。**
 *
 * **import の有無だけでは足りない。** だいどこは「包んでいるか」を import で見ていて、
 * **モーダルの内側だけを包んだ画面が素通りしていた**（daidoko f17b1ce で発覚）。
 * ここでは `<Modal>` の内と外を切り分けて別々に検査する。さいえん手帳は今のところ
 * モーダル内に入力欄が無いが、`BottomSheet` が `Modal` なので置いた瞬間に効く。
 *
 * 落ちたときは、まず**包む**こと。包まないと決めたなら EXEMPT に理由を書く。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const MOBILE_DIR = resolve(__dirname, '../../..');
const SCAN_DIRS = [join(MOBILE_DIR, 'app'), join(MOBILE_DIR, 'src', 'components')];

/**
 * それ自体は「画面」ではなく、画面に埋め込まれる入力部品。
 * これらを描画しているファイルは、入力欄を持つとみなす（包むのは呼び出し側）。
 *
 * **ソフトキーボードを出すものだけを入れる。** 例えば `DateField` は
 * `DateTimePicker` と `Pressable` だけでキーボードを出さないので対象外
 * （入れると、日付しか無い画面まで包めと言い出して EXEMPT が水増しされる）。
 * 下の「INPUT_PARTS は実際に入力欄を持つ」がこの前提を見張る。
 */
const INPUT_PARTS = ['FormField', 'TagSelector'];

/** KeyboardAvoider で包まない画面と、その理由。無条件に足さないこと。 */
const EXEMPT: Record<string, string> = {
  'src/components/FormField.tsx': '入力欄そのもの（部品）。包むのは、これを並べる画面側。',
  'src/components/TagSelector.tsx':
    '入力欄と追加ボタンが横並びの部品。包むのは、これを置く PlantingForm 側。',
  'app/(tabs)/plantings/index.tsx':
    '検索欄は画面の最上部にあり、その下に隠れて困るボタンが無い（結果は一覧なのでスクロールで届く）。' +
    'FlatList に keyboardShouldPersistTaps を入れてあるので、1 タップ目が消費されることもない。',
  'app/(tabs)/materials/shopping.tsx':
    '追加欄と「追加」ボタンは画面上部のバーで横並び。キーボードが覆うのは下の一覧だけで、' +
    '一覧はスクロールで届く。',
};

function collectFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      collectFiles(full, acc);
    } else if (entry.name.endsWith('.tsx')) {
      acc.push(full);
    }
  }
  return acc;
}

/** apps/mobile からの相対（POSIX 区切り）。EXEMPT のキーと揃える。 */
function fileKey(fullPath: string): string {
  return fullPath
    .slice(MOBILE_DIR.length + 1)
    .split(/[\\/]/)
    .join('/');
}

/**
 * `<Modal ...>` 〜 `</Modal>` を落として、モーダル**外**のツリーだけを残す。
 *
 * import の有無だけを見ていると、**モーダルの内側だけを包んだ画面が素通りする**
 * （だいどこで実際に起きた — `import-photo` が検査をすり抜けていた・daidoko f17b1ce）。
 * さいえん手帳は `BottomSheet` が `Modal` を使っているので、そこへ入力欄を
 * 置いた瞬間に同じ穴が開く。**外側と内側を別々に検査する。**
 */
function stripModalBlocks(source: string): string {
  let result = '';
  let rest = source;
  for (;;) {
    const start = rest.indexOf('<Modal');
    if (start < 0) return result + rest;
    const end = rest.indexOf('</Modal>', start);
    if (end < 0) return result + rest.slice(0, start); // 閉じが無ければ以降は捨てる
    result += rest.slice(0, start);
    rest = rest.slice(end + '</Modal>'.length);
  }
}

/** `<Modal ...>` 〜 `</Modal>` の中身だけを取り出す（複数あればすべて）。 */
function modalBlocks(source: string): string[] {
  const blocks: string[] = [];
  let rest = source;
  for (;;) {
    const start = rest.indexOf('<Modal');
    if (start < 0) return blocks;
    const end = rest.indexOf('</Modal>', start);
    if (end < 0) return blocks;
    blocks.push(rest.slice(start, end));
    rest = rest.slice(end + '</Modal>'.length);
  }
}

/** 直接の `<TextInput`、または入力部品を描画しているか */
function hasInput(source: string): boolean {
  if (source.includes('<TextInput')) return true;
  return INPUT_PARTS.some((part) => source.includes(`<${part}`));
}

const files = SCAN_DIRS.flatMap((dir) => collectFiles(dir)).map((path) => {
  const source = readFileSync(path, 'utf8');
  return { key: fileKey(path), source, outer: stripModalBlocks(source) };
});

/** モーダルの**外**に入力欄がある = 画面本体を包む必要がある */
const withInput = files.filter((file) => hasInput(file.outer));

/** モーダルの**中**に入力欄がある = モーダルの内側にも包む必要がある */
const withModalInput = files.flatMap((file) =>
  modalBlocks(file.source)
    .filter(hasInput)
    .map((block, index) => ({ key: `${file.key} の Modal#${index + 1}`, block })),
);

describe('KeyboardAvoider coverage', () => {
  it('走査対象を実際に見つけている（パス解決が壊れたら気づく）', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(withInput.length).toBeGreaterThan(8);
  });

  it.each(withInput.map((file) => file.key))(
    '%s は KeyboardAvoider で包まれている（または理由つきで除外されている）',
    (key) => {
      if (EXEMPT[key]) return; // 理由は EXEMPT に記録済み
      const file = withInput.find((candidate) => candidate.key === key);
      expect(file?.source).toMatch(/from '.*KeyboardAvoider'/);
    },
  );

  it('モーダルの内外を切り分ける仕組み自体が動く（対象ゼロで素通りしていないこと）', () => {
    // 現状さいえん手帳にはモーダル内の入力欄が無く、上の検査は「対象ゼロ」で通る。
    // 仕組みが壊れても気づけないので、合成した入力で内外の切り分けを直接確かめる。
    const synthetic = [
      '<View>',
      '  <Modal visible={x}>',
      '    <TextInput value={a} />',
      '  </Modal>',
      '</View>',
    ].join('\n');

    expect(hasInput(synthetic)).toBe(true); // 全体で見れば入力欄はある
    expect(hasInput(stripModalBlocks(synthetic))).toBe(false); // モーダル外には無い
    expect(modalBlocks(synthetic)).toHaveLength(1);
    expect(hasInput(modalBlocks(synthetic)[0])).toBe(true); // モーダル内にはある
  });

  it('Modal の中に入力欄がある画面は、モーダルの内側にも KeyboardAvoider を置いている', () => {
    // 画面全体を包んでも Modal の中身は別ツリーなので効かない。
    // 現状さいえん手帳に該当は無いが、BottomSheet が Modal なので置いた瞬間に効く。
    const missing = withModalInput
      .filter((entry) => !entry.block.includes('<KeyboardAvoider'))
      .map((entry) => entry.key);
    expect(missing).toEqual([]);
  });

  it.each(INPUT_PARTS)('INPUT_PARTS の %s は実際に入力欄を持つ', (part) => {
    const file = files.find((candidate) => candidate.key.endsWith(`components/${part}.tsx`));
    if (!file) throw new Error(`${part}.tsx が見つからない（INPUT_PARTS の名前が古い？）`);
    expect(file.source).toContain('<TextInput');
  });

  it('包んだ画面は KeyboardAvoidingView を直に使っていない（behavior の指定漏れを防ぐ）', () => {
    const direct = files.filter(
      (file) =>
        file.source.includes('<KeyboardAvoidingView') && !file.key.endsWith('KeyboardAvoider.tsx'),
    );
    expect(direct.map((file) => file.key)).toEqual([]);
  });

  it('EXEMPT に、もう入力欄が無いファイルや消えたファイルが残っていない', () => {
    for (const key of Object.keys(EXEMPT)) {
      expect(withInput.map((file) => file.key)).toContain(key);
    }
  });
});
