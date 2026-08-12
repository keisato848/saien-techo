---
name: sanitize-user-media
description: ユーザーから受け取った写真・動画をリポジトリやアプリへ入れる前に、位置情報などの個人情報を除去して検証する手順。EXIF/GPS の除去、生バイト列の走査、内容の目視、配布物への同梱確認まで。サンプルデータ用の画像も配布されるため対象。
---

# 提供メディアの個人情報除去

> **スマホの写真は既定で自宅の座標を持つ。** 提供された 4 枚には GPS 座標・標高・
> 撮影方向・端末名（Pixel 9a）・撮影時刻がすべて入っていた（2026-08-12）。

## 0. 前提 — 「開発用だから配られない」は誤り

`apps/mobile/assets/` に置いた画像は **APK/AAB に同梱されて全利用者へ配布される**。
`require()` を Metro が**ビルド時に静的解決**するため、`EXPO_PUBLIC_ENABLE_SAMPLE_DATA`
のような**実行時**フラグでは同梱を止められない（止まるのは表示だけ）。

実測: サンプル写真 4 枚が、サンプルデータ**無効**でビルドした提出用 AAB の
`base/res/drawable-mdpi-v4/` に入っていた。利用者は APK を展開すれば中身もメタデータも読める。

> 配布そのものを避けたいなら静的 require を外す必要がある（WBS 3.13a）。
> **このスキルは「配布される前提で安全にする」手順**。

## 1. 受け取り時の確認（除去より先）

除去しても**写っているもの**は消えない。先に目視する。

- 人物の顔・後ろ姿・足元
- 表札・番地・郵便受け・宅配ラベル
- 車のナンバープレート
- 隣家の窓・洗濯物など、第三者のプライバシー

**アプリで正方形にクロップされるからといって安心しない** — 元ファイルが配布される。
クロップは表示側の話。危ないものが写っていたら**そのファイルは使わない**。

## 2. 除去（sharp で再エンコード）

メタデータを「消す」のではなく、**画素だけを取り出して新しいファイルを作る**。

```js
await sharp(src)
  .rotate() // EXIF の向きを画素に焼いてから捨てる（これが無いと横倒しになる）
  .resize(1200, 1200, { fit: 'cover', position: 'centre' })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(dest);
```

sharp は既定でメタデータを引き継がない（`withMetadata()` を**呼ばない**こと）。
`.rotate()` を省くと、向き情報を捨てた結果として画像が回転して見える。

## 3. 検証（2 段構え。EXIF チェックだけでは足りない）

```bash
# 3-1. EXIF / GPS が 0 か
python -c "
from PIL import Image, ExifTags
im = Image.open('<dest.jpg>')
ex = im.getexif()
print('EXIF:', len(ex), 'GPS:', len(ex.get_ifd(ExifTags.IFD.GPSInfo) or {}))
"

# 3-2. EXIF 以外の領域に残っていないか（XMP・ICC・独自セグメント）
grep -a -o -E "GPS|Pixel|Google|Exif|HDR\+|Camera" <dest.jpg> | sort -u
```

**3-2 を省かない。** メタデータは EXIF 以外の領域にも入る。
`grep` が何も返さないことを確認する。

## 4. 配布物での最終確認

リリース前に、実際にビルドした AAB を開いて中身を見る（`release-verify` §6）。

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("<app-release.aab>")
$zip.Entries | Where-Object { $_.FullName -match '\.(jpg|jpeg|png)$' -and $_.FullName -match 'assets' } |
  ForEach-Object { "{0}  ({1} bytes)" -f $_.FullName, $_.Length }
$zip.Dispose()
```

## 5. 差し替えるときも同じ手順を通す

サンプル写真の差し替えは「開発用の絵を入れ替えるだけ」に見えるが、
**配布物と個人情報の話**である。`seed-photos.ts` の冒頭にもこの前提を書いてある。

`apps/mobile/assets/` 配下への画像・音声の書き込みは **PreToolUse ガードが ask で止める**
（`hook-pretool-edit-guard.mjs`）。止まったら、このスキルの 1〜3 を済ませたか確認する。

## 6. ストア掲載物

スクリーンショットは `screencap` が生成する PNG なので EXIF は無い。
ただし**写り込み**（サンプルデータに実名・住所・電話番号・メールが出ていないか）は見る。
掲載文・リリースノートに開発者の個人情報が混ざっていないかも同様（`release-verify` §6-2）。
