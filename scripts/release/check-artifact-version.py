#!/usr/bin/env python3
"""成果物（AAB / APK）の鮮度チェック — 「検証している物は、いま出そうとしている版か」。

1.1 リリース（2026-08-22）で、監視を「AAB ファイルの存在」にしたために 8/14 の
古い AAB（v1.0.0）を拾い、それに対して 16KB / 権限 / EXIF の検証を回して
「3 項目 PASS」と報告してしまった。本命のビルドは同時実行で壊れていた。
提出前に気づいたが、気づかなければ旧版の検証結果を根拠に 1.1 を出していた。

このスクリプトは release-verify の **手順 0** と submit-play-release.mjs の**送信前**で走り、
次の 3 つを機械で確かめる:

  1. 成果物の versionName / versionCode が apps/mobile/app.json と一致する
  2. 成果物の更新時刻が app.json の最終コミット時刻より新しい（古い成果物の検出）
  3. 成果物の更新時刻が「いま」からかけ離れていない（既定 24 時間・警告のみ）

読み取り方:
  - AAB: base/manifest/AndroidManifest.xml は **protobuf XML**（aapt2 形式）。
    Attribute { name(2)="versionCode", value(3)="3" } の value を素直に拾う。
    バイナリ AXML ではないので bundletool 無しで読める。
  - APK: AndroidManifest.xml は **バイナリ AXML**。aapt2 dump badging に任せる
    （build-tools が無い環境では APK 側は検証できないと明示して落とす）。

使い方:
  python scripts/release/check-artifact-version.py <app-release.aab|apk>
      [--expect-version 1.1.0] [--expect-code 3] [--max-age-hours 24] [--quiet]

終了コード: 0 = 一致、1 = 不一致/古い成果物、2 = 読み取り不能（環境不足など）。
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import subprocess
import sys
import time
import zipfile

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
APP_JSON = os.path.join(ROOT, "apps", "mobile", "app.json")


def read_app_json() -> tuple[str, int]:
    with open(APP_JSON, encoding="utf-8") as f:
        expo = json.load(f)["expo"]
    return str(expo["version"]), int(expo["android"]["versionCode"])


# ─── AAB（protobuf XML）────────────────────────────────────────────────────────


def _proto_string_after(data: bytes, key: bytes) -> str | None:
    """Attribute.name == key の直後にある value（field 3, wire type 2 → 0x1a + varint len）を返す。"""
    idx = data.find(key)
    while idx != -1:
        pos = idx + len(key)
        if pos < len(data) and data[pos] == 0x1A:
            pos += 1
            length = 0
            shift = 0
            while True:
                b = data[pos]
                pos += 1
                length |= (b & 0x7F) << shift
                if b < 0x80:
                    break
                shift += 7
            return data[pos : pos + length].decode("utf-8", "replace")
        idx = data.find(key, idx + 1)
    return None


def read_aab(path: str) -> tuple[str, int]:
    with zipfile.ZipFile(path) as z:
        data = z.read("base/manifest/AndroidManifest.xml")
    name = _proto_string_after(data, b"versionName")
    code = _proto_string_after(data, b"versionCode")
    if name is None or code is None or not code.isdigit():
        raise RuntimeError("AAB のマニフェストから versionName / versionCode を読めませんでした")
    return name, int(code)


# ─── APK（バイナリ AXML → aapt2）──────────────────────────────────────────────


def find_aapt2() -> str | None:
    candidates = []
    for env in ("ANDROID_HOME", "ANDROID_SDK_ROOT"):
        if os.environ.get(env):
            candidates.append(os.path.join(os.environ[env], "build-tools"))
    if os.environ.get("LOCALAPPDATA"):
        candidates.append(os.path.join(os.environ["LOCALAPPDATA"], "Android", "Sdk", "build-tools"))
    exe = "aapt2.exe" if os.name == "nt" else "aapt2"
    for base in candidates:
        hits = sorted(glob.glob(os.path.join(base, "*", exe)))
        if hits:
            return hits[-1]  # 最新の build-tools
    return None


def read_apk(path: str) -> tuple[str, int]:
    aapt2 = find_aapt2()
    if not aapt2:
        raise EnvironmentError("aapt2 が見つかりません（Android SDK build-tools が必要）")
    out = subprocess.run([aapt2, "dump", "badging", path], capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError(f"aapt2 dump badging が失敗: {out.stderr.strip()[:200]}")
    m = re.search(r"versionCode='(\d+)'\s+versionName='([^']*)'", out.stdout)
    if not m:
        raise RuntimeError("aapt2 の出力から versionCode / versionName を読めませんでした")
    return m.group(2), int(m.group(1))


# ─── 鮮度（時刻）──────────────────────────────────────────────────────────────


def app_json_commit_time() -> int | None:
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%ct", "--", "apps/mobile/app.json"],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        return int(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip() else None
    except (OSError, ValueError):
        return None


def main() -> int:
    # PowerShell / cp932 コンソールで日本語が化けても落ちないようにする
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("artifact", help="app-release.aab または .apk")
    ap.add_argument("--expect-version", help="期待する versionName（既定: app.json）")
    ap.add_argument("--expect-code", type=int, help="期待する versionCode（既定: app.json）")
    ap.add_argument("--max-age-hours", type=float, default=24.0, help="これより古ければ警告（既定 24）")
    ap.add_argument("--quiet", action="store_true", help="結果行だけ出す")
    args = ap.parse_args()

    path = os.path.abspath(args.artifact)
    if not os.path.exists(path):
        print(f"[NG] 成果物がありません: {path}")
        return 2

    exp_name, exp_code = read_app_json()
    if args.expect_version:
        exp_name = args.expect_version
    if args.expect_code is not None:
        exp_code = args.expect_code

    try:
        if path.lower().endswith(".aab"):
            got_name, got_code = read_aab(path)
        elif path.lower().endswith(".apk"):
            got_name, got_code = read_apk(path)
        else:
            print("[NG] .aab か .apk を指定してください")
            return 2
    except EnvironmentError as e:
        print(f"[NG] 読み取り不能: {e}")
        return 2
    except Exception as e:  # noqa: BLE001 — 読み取り失敗は検証不能として 2
        print(f"[NG] 読み取り失敗: {e}")
        return 2

    mtime = os.path.getmtime(path)
    age_h = (time.time() - mtime) / 3600
    commit_ts = app_json_commit_time()

    problems = []
    warnings = []
    if got_name != exp_name:
        problems.append(f"versionName: 成果物 {got_name} / app.json {exp_name}")
    if got_code != exp_code:
        problems.append(f"versionCode: 成果物 {got_code} / app.json {exp_code}")
    if commit_ts is not None and mtime < commit_ts:
        problems.append(
            "成果物が app.json の最終コミット（%s）より古い（%s）— 古いビルドを検証している"
            % (time.strftime("%m-%d %H:%M", time.localtime(commit_ts)), time.strftime("%m-%d %H:%M", time.localtime(mtime)))
        )
    if age_h > args.max_age_hours:
        warnings.append(f"成果物が {age_h:.1f} 時間前のもの（--max-age-hours {args.max_age_hours:g}）")

    if not args.quiet:
        print(f"artifact : {os.path.relpath(path, ROOT)}")
        print(f"built    : {time.strftime('%Y-%m-%d %H:%M', time.localtime(mtime))}（{age_h:.1f} 時間前）")
        print(f"version  : {got_name} (code {got_code})   expected: {exp_name} (code {exp_code})")
    for w in warnings:
        print(f"[WARN] {w}")
    if problems:
        for p in problems:
            print(f"[NG] {p}")
        print("FAIL: この成果物は app.json と一致しない、または古い。ビルドし直してから検証すること。")
        return 1
    print(f"PASS: 成果物は {exp_name} (code {exp_code}) と一致し、app.json より新しい。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
