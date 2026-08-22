/**
 * jest の共通セットアップ。
 *
 * さいえん手帳の画面はほぼすべて useSafeAreaInsets を使う（ノッチとジェスチャー
 * バーの実測値でレイアウトするため）。Provider が無いと render で落ちるので、
 * ここで一括して差し替える。各テストで書くと必ず書き漏らす。
 *
 * インセットは 0 ではなく実機に近い値にしている。0 だと
 * 「paddingTop: insets.top + 12」のような式が素通りしてしまう。
 */
/*
 * 画面テストは 1 本目でモジュール読み込みを丸ごと背負うため、既定の 5 秒では
 * 足りない（HarvestForm の 1 本目は実測 11 秒、栽培詳細は 18 秒）。実装の待ちではなく
 * 読み込みの待ちなので、ここで一律に伸ばす。
 *
 * 60 秒にしているのは、1 本目で waitFor に 20 秒を積んでいる画面テストがあるため。
 * 30 秒だと、ワーカーが競り合ったときに waitFor の待ちきりよりテスト側の
 * 打ち切りが先に来て、原因の分からない失敗になる。
 */
jest.setTimeout(60_000);

jest.mock('react-native-safe-area-context', () => {
  // jest.mock のファクトリからは外の変数を参照できないので require はこの中で行う
  const react = require('react');
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 24, right: 0, bottom: 16, left: 0 }),
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
    SafeAreaProvider: ({ children }) => react.createElement(react.Fragment, null, children),
  };
});
