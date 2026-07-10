# JAMS 引き継ぎフォルダ

このフォルダは、次期部長へJAMSを引き継ぐために必要な資料と設定例をまとめたものです。

## 最初に読むファイル

1. `HANDOVER.md`
   - 次期部長向けの運用・権限・緊急時対応の説明です。

2. `README.md`
   - システム構成、開発、デプロイ、D1、メール送信などの技術説明です。

## 含めているファイル

- `HANDOVER.md`
- `README.md`
- `.env.example`
- `config.example.js`
- `google-apps-script-mailer.gs`
- `package.json`
- `wrangler.toml`
- `worker/schema.sql`
- `worker/migrations/*.sql`

## 含めていないファイル

次のファイルや値は機密情報を含むため、このフォルダには入れていません。

- `.env`
- `.cloudflare-secrets.env`
- Discord Bot Token
- Discord Client Secret
- Cloudflare API Token
- Google Apps Script Mail Secret
- Worker Secretsの実値

これらは、次期部長へ別途安全な方法で引き継いでください。

## 注意

このフォルダだけでは、本番環境の操作はできません。実際に運用・復旧するには、GitHub、Cloudflare、Discord Developer Portal、Google Apps Scriptの権限が必要です。

