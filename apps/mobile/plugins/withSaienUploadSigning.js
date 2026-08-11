/**
 * Play アップロード署名を app/build.gradle に注入する config plugin（WBS 3.9）。
 *
 * android/ は gitignore なので、手でパッチした署名設定は expo prebuild で消える。
 * ここに置けば prebuild のたびに自動で入る（withDaidokoBackupRules と同じ立て付け）。
 *
 * 仕組み:
 * - SAIEN_UPLOAD_*（env または android/keystore.properties）があれば release 署名に使う
 * - 無ければ release も debug 署名 = ローカル検証用（従来どおり）
 * - ただし bundleRelease だけは未設定なら失敗させる — debug 署名の AAB を
 *   Play へ上げる事故の安全弁。資格情報は C:/secure/saien-upload-credentials.properties
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const SIGNING_BLOCK = `        release {
            def props = new Properties()
            def propsFile = rootProject.file('keystore.properties')
            if (propsFile.exists()) {
                propsFile.withInputStream { props.load(it) }
            }
            def storeFilePath = System.getenv('SAIEN_UPLOAD_STORE_FILE') ?: props.getProperty('SAIEN_UPLOAD_STORE_FILE')
            if (storeFilePath) {
                storeFile file(storeFilePath)
                storePassword System.getenv('SAIEN_UPLOAD_STORE_PASSWORD') ?: props.getProperty('SAIEN_UPLOAD_STORE_PASSWORD')
                keyAlias System.getenv('SAIEN_UPLOAD_KEY_ALIAS') ?: props.getProperty('SAIEN_UPLOAD_KEY_ALIAS')
                keyPassword System.getenv('SAIEN_UPLOAD_KEY_PASSWORD') ?: props.getProperty('SAIEN_UPLOAD_KEY_PASSWORD')
            }
        }
`;

const BUNDLE_GATE = `
// Play へ上げる AAB が debug 署名にならないよう、bundleRelease はアップロード署名必須
tasks.whenTaskAdded { task ->
    if (task.name == 'bundleRelease' && !android.signingConfigs.release.storeFile) {
        task.doFirst {
            throw new GradleException('SAIEN_UPLOAD_* が未設定です。C:/secure/saien-upload-credentials.properties を参照してください')
        }
    }
}
`;

module.exports = function withSaienUploadSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let contents = gradleConfig.modResults.contents;
    if (contents.includes('SAIEN_UPLOAD_STORE_FILE')) return gradleConfig; // 適用済み

    // signingConfigs へ release を追加（debug ブロックの直後）
    const debugBlock = /(signingConfigs \{\n        debug \{[\s\S]*?\n        \}\n)/;
    if (!debugBlock.test(contents)) {
      throw new Error(
        'withSaienUploadSigning: signingConfigs.debug が見つからない（テンプレート変更?）',
      );
    }
    contents = contents.replace(debugBlock, `$1${SIGNING_BLOCK}`);

    // release ビルドタイプの署名を条件分岐に
    const releaseSigning =
      'signingConfig signingConfigs.debug\n            def enableShrinkResources';
    if (!contents.includes(releaseSigning)) {
      throw new Error(
        'withSaienUploadSigning: release の signingConfig 行が見つからない（テンプレート変更?）',
      );
    }
    contents = contents.replace(
      releaseSigning,
      'signingConfig signingConfigs.release.storeFile ? signingConfigs.release : signingConfigs.debug\n            def enableShrinkResources',
    );

    gradleConfig.modResults.contents = contents + BUNDLE_GATE;
    return gradleConfig;
  });
};
