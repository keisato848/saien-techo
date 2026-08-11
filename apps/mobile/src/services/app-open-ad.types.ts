/**
 * 起動広告のプロバイダ境界（§8.2 / WBS 3.7）
 *
 * SDK を直接触るのは admob 実装だけにして、画面と起動処理はこの型だけを見る。
 * web バンドルに SDK を持ち込まないための .web 兄弟ファイルも同じ型を実装する。
 */

export interface AppOpenAdProvider {
  /** UMP の同意を解決し、広告を要求できる状態か返す。例外は投げない */
  prepare(): Promise<{ canRequestAds: boolean }>;
  /** 読み込んで表示する。表示できたら true。失敗しても例外は投げない */
  showAppOpenAd(): Promise<boolean>;
  /** 設定に「広告のプライバシー設定」行を出すべき地域か */
  isPrivacyOptionsRequired(): Promise<boolean>;
  /** 同意のやり直し（UMP のプライバシーフォーム） */
  showPrivacyOptionsForm(): Promise<void>;
}
