/**
 * キーボードで入力欄や下部のボタンが隠れないようにする共通ラッパー。
 *
 * **`behavior` を Android で未指定にしてはいけない。** `AndroidManifest` は
 * `adjustResize` を指定しているが、この構成では**ウィンドウがリサイズされず**、
 * ソフトキーボードが画面の上に重なるだけになる。その状態で `behavior=undefined` にすると
 * `KeyboardAvoidingView` はただの `View` になり、キーボードの下に入った領域へ
 * 一切たどり着けなくなる（`ScrollView` の高さも変わらないので、内容が画面に収まっていれば
 * スクロールも効かない）。実機 AQUOS SH-RM19s (Android 13) とエミュレータ API 36 の
 * 両方で再現する。そのため **両プラットフォームで `padding`** を使う。RN は
 * キーボードの高さを `keyboardDidShow` で通知するので、リサイズされない環境でも余白が入る。
 *
 * **入力欄のある画面は必ずこれで包む。** 個々の画面で `KeyboardAvoidingView` を直に使うと、
 * また `behavior` の指定漏れが起きる。**この規約は
 * `__tests__/keyboard-avoider-coverage.test.ts` が機械的に見張る** —
 * だいどこでは同じ規約を文章だけで書いていて、主役機能を含む 5 画面が漏れた（daidoko#172）。
 *
 * 包む位置は**画面全体の根**。`padding` は下端に入るので、上部ヘッダーの
 * 「保存」は動かず、その下の `ScrollView` だけが縮む（さいえん手帳のフォームは
 * 送信ボタンがヘッダーにある形なので、これで狙いどおりになる）。
 *
 * `Modal` の中身は画面本体とは**別のツリー**なので、画面を包んでもモーダル内には
 * 効かない。モーダルの内側にも個別に置くこと（`BottomSheet` が `Modal`）。
 *
 * ## これで救えないもの — 入力欄の**直下に続くボタン**
 *
 * `padding` は表示領域を**キーボードの上端で切る**。Android はフォーカスした欄が
 * 「ぎりぎり見える位置」までスクロールするので、**入力欄の下端＝キーボードの上端**になり、
 * その直下に置いたボタンには 1px も残らない。だいどこはレシピ作成の「材料名」→
 * 「+ 材料を追加」でこれを踏み、**打つたびにキーボードを閉じてスクロールし直す往復**が
 * 必要になった（daidoko f17b1ce・実機 AQUOS SH-RM19s で再現）。
 *
 * さいえん手帳では**繰り返し押す形が無い**ので実害は小さい — フォームの送信は
 * 上部ヘッダーにあり、`TagSelector` の「追加」は入力欄の**横**にある。
 * 下に続くのは `consult` の「AI に相談する」と `OnboardingSheet` の「はじめる」で、
 * どちらも 1 回押すだけ。だいどこは `react-native-keyboard-controller` へ移ったが、
 * こちらは reanimated を持っていないため**ネイティブ依存が 3 つ増える**。
 * 判断と着手時期は Issue に置いた。
 */
import { KeyboardAvoidingView, StyleSheet, type ViewStyle } from 'react-native';

interface KeyboardAvoiderProps {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  /**
   * ヘッダーなど、キーボードの高さから差し引きたい分。
   * 既定 0（画面全体を包む前提）。
   */
  offset?: number;
  /** 包む前の根が持っていた testID を引き継ぐため */
  testID?: string;
}

export function KeyboardAvoider({ children, style, offset = 0, testID }: KeyboardAvoiderProps) {
  return (
    <KeyboardAvoidingView
      style={[styles.fill, style]}
      behavior="padding"
      keyboardVerticalOffset={offset}
      testID={testID}
    >
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
