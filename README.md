# Classroom Reservation (Next.js)

簡潔な概要
----------------
- このプロジェクトは Next.js(TypeScript) と Tailwind CSS を使った教室予約／公開カレンダーのフロントエンドです。外部の iCal (.ics) を取得して整形し、クライアントへ提供する API を含みます。

主な機能
----------------
- `/api/public-calendar` API
  - 外部 ICS を取得してパースしたイベントを JSON で返します。
  - `?start=YYYY-MM-DD&end=YYYY-MM-DD` で期間指定可能（サーバー側で範囲フィルタ）。
  - `?refresh=1&token=...` または `x-refresh-token` ヘッダで即時更新をトリガ可能（`CALENDAR_REFRESH_TOKEN` が設定されている場合はトークン必須）。
- サーバー側キャッシュ
  - `utils/calendarStore.ts` により、取得済みイベントをメモリと `cache/public-calendar.json` に保存します。
  - 自動更新はデフォルトで5分毎（`initStore(calendarUrl, intervalMs)` の既定値）。

重要なファイル
----------------
- `pages/api/public-calendar.ts` — API エンドポイント（範囲フィルタ／refresh トークン検証）
- `utils/calendarStore.ts` — 取得・パース・キャッシュのロジック（ディスク保存）
- `cache/public-calendar.json` — パース済みキャッシュ（自動生成）
- `.github/workflows/refresh-calendar.yml` — GitHub Actions で 5 分毎にキャッシュ更新を叩くワークフロー

環境変数
----------------
- `PUBLIC_CALENDAR_URL` (必須)
  - 取得する iCal の URL（例: `https://example.com/calendar.ics`）
- `CALENDAR_REFRESH_TOKEN` (任意だが推奨)
  - 即時更新エンドポイントを保護するトークン。設定すると `?token=...` か `x-refresh-token` ヘッダで一致する必要があります。
- (開発時のプロキシ設定)
  - 開発環境で社内プロキシを使う場合、Node のリクエストがプロキシ経由になり失敗することがあります。必要に応じて `NO_PROXY` 等を設定してください。

ローカルでの実行方法
----------------
1. 依存関係のインストール
```bash
npm install
```

2. 環境変数を用意（プロジェクトルートに `.env` または `export`）
```env
PUBLIC_CALENDAR_URL=https://.../calendar.ics
CALENDAR_REFRESH_TOKEN=your-secret-token
```

3. 開発サーバー起動
```bash
npm run dev
# ブラウザで http://localhost:3000 を開く
```

4. 強制更新（ローカルテスト）
```bash
# クエリでトークン
curl -i 'http://localhost:3000/api/public-calendar?refresh=1&token=your-secret-token'
# またはヘッダで
curl -i -H 'x-refresh-token: your-secret-token' 'http://localhost:3000/api/public-calendar?refresh=1'
```

API の使い方（短く）
----------------
- 全件取得（キャッシュされたものを返します）
```bash
curl -s 'http://localhost:3000/api/public-calendar' | jq '.value | length'
```
- 期間指定（例）
```bash
curl -s 'http://localhost:3000/api/public-calendar?start=2025-11-01&end=2025-11-30' | jq '.value'
```

運用（Vercel と GitHub Actions）
----------------
- Next.js を Vercel にデプロイ済みの場合、サーバーレス環境ではプロセスが短命なため `setInterval` による自動更新は期待通り動作しない可能性があります。
  - そこでこのリポジトリには GitHub Actions ワークフロー（`.github/workflows/refresh-calendar.yml`）を用意しました。
  - 手順:
    1. GitHub リポジトリの Secrets に `CALENDAR_REFRESH_TOKEN` と `SITE_URL` を登録（`SITE_URL` は `my-app.vercel.app` のようにホスト名だけでOK）。
    2. ワークフローが 5 分毎に `https://$SITE_URL/api/public-calendar?refresh=1&token=$CALENDAR_REFRESH_TOKEN` を叩いてキャッシュを更新します。

セキュリティと注意点
----------------
- `CALENDAR_REFRESH_TOKEN` を必ず GitHub Secrets / Vercel の Environment に登録し、`.env` をリポジトリにコミットしないでください。
- もしトークンを誤ってコミットしてしまった場合は、即時ローテーション（新しいトークン発行→Secrets/Env 更新→古いトークン無効化）と、可能であれば履歴からの削除（BFG / git filter-repo）を行ってください。必要なら手順を支援します。
- 外部の ICS が認証（Office365 等）で保護されている場合、公開 URL が必要です。社内プロキシ経由での取得は `HTTPS_PROXY` / `NO_PROXY` 等の環境変数を調整してください。

トラブルシューティング（よくある問題）
----------------
- `getaddrinfo ENOTFOUND proxy...` や `Could not resolve host: https` のエラー
  - 開発マシンでプロキシ環境変数が原因の場合があります。`unset HTTPS_PROXY` や `export NO_PROXY=outlook.office365.com` を試し、再起動してください。
- `Strong refresh failed`（強制更新が 500 になる）
  - API のログ（dev ターミナル）を確認してください。外部取得や node-ical のパースで失敗していることが多いです。
- ICS が大きすぎる/イベント数が多い
  - サーバー側で一度パースしてキャッシュする現在の設計は、複数回のダウンロードを防いで高速化します。将来的にさらにスケールする場合は DB 保存（Postgres/SQLite）に移行することを検討してください。

トークン生成コマンド（macOS / zsh）
----------------
```bash
# 64 文字（hex）
openssl rand -hex 32 | pbcopy && openssl rand -hex 32

# 128 文字（hex）
openssl rand -hex 64 | pbcopy && openssl rand -hex 64
```

削除しておくと良いファイル
----------------
- `.env` はローカルで保持し、リポジトリにはコミットしないでください。既にコミット済みの場合は早めに削除し、`.gitignore` に追加してください。

開発者向けのヒント
----------------
- イベントの期間フィルタは `pages/api/public-calendar.ts` 側で行っているため、クライアント側は必要な期間だけ要求してください（パフォーマンス改善）。
- もし即時性が必要で Microsoft Forms 等と連携しているなら、Forms の送信トリガで Power Automate（Flow）から `?refresh=1&token=...` を呼ぶと無駄なポーリングを減らせます。

さらにサポートが必要なら
----------------
不明点や追加実装（DB移行、トークンローテーション支援、Power Automate 設定文の作成など）は対応します。必要な作業を教えてください。

---
作成: project automation
Welcome to the NextJS base template bootstrapped using the `create-next-app`. This template supports TypeScript, but you can use normal JavaScript as well.

## Getting Started

Hit the run button to start the development server.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.

[API routes](https://nextjs.org/docs/api-routes/introduction) can be accessed on `/api/hello`. This endpoint can be edited in `pages/api/hello.ts`.

The `pages/api` directory is mapped to `/api/*`. Files in this directory are treated as [API routes](https://nextjs.org/docs/api-routes/introduction) instead of React pages.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

## Productionizing your Next App

To make your next App run smoothly in production make sure to deploy your project with [Repl Deployments](https://docs.replit.com/hosting/deployments/about-deployments)!

You can also produce a production build by running `npm run build` and [changing the run command](https://docs.replit.com/programming-ide/configuring-repl#run) to `npm run start`.
