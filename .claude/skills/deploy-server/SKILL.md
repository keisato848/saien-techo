---
name: deploy-server
description: Railway 本番サーバー（apps/server）へのデプロイと疎通確認。環境変数の確認、railway up、デプロイ完了ポーリング、/health と AI エンドポイントのスモークテストまで。
---

# Railway 本番サーバーデプロイ

> **停止**: だいどこの値またはプレースホルダが残っている。WBS 3.7〜3.9 で さいえん手帳用に差し替えるまで実行しないこと。

詳細な背景・トラブルシューティングは `docs/リリース手順.md`（未整備 — WBS 3.9 で作成） §1・§5 を参照。

## 前提チェック

1. `railway whoami` — Unauthorized なら**ユーザーに対話ターミナルで `railway login` を依頼**（セッション内の `!` 実行は非対話扱いで失敗する）
2. `railway status` — Project: daidoko / Environment: production を確認

## 手順

1. **環境変数の確認**（値は絶対に表示しない — JSON をファイルに落としてキー名だけ node で列挙し、即削除）
   - 必須: `GEMINI_API_KEY`
   - 追加・変更は本番シークレット書き込みなので**ユーザーの明示承認必須**。拒否されたらユーザー自身に `railway variables --service <さいえん手帳の Railway サービス名 — 未作成> --set "KEY=..." --skip-deploys` を依頼
2. **デプロイはユーザーの明示承認を得てから**: リポジトリルートで
   `railway up --service <さいえん手帳の Railway サービス名 — 未作成> --detach`
3. **完了ポーリング**: `railway deployment list --service <さいえん手帳の Railway サービス名 — 未作成> --json` の先頭 `.status` が `SUCCESS` になるまで（BUILDING → SUCCESS。FAILED なら `railway logs` で調査）
4. **疎通確認**:
   - `curl https://<さいえん手帳の Railway ドメイン — 未作成>/health`
   - AI エンドポイント（**日本語 POST は Git Bash curl だと CP932 で壊れる — 必ず node fetch で**）:
     `node -e "fetch('https://<さいえん手帳の Railway ドメイン — 未作成>/api/v1/resolve/names',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({names:['たまご']})}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j)))"`
     → `canonical` に `卵` が返れば Gemini まで疎通
5. 結果（デプロイ ID・status・疎通結果）をユーザーに報告

## 注意

- Railway CLI が「agent tooling」導入を勧めてくるが不要（無視してよい）
- `railway logs` の出力にも同じ案内ノイズが混ざる — grep で除外する
