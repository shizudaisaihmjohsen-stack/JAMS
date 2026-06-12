# JAMS

情報宣伝部 部員認証・管理システム。

## 現在の実装範囲

- GitHub Pages でそのまま公開できる静的フロントエンド
- S-GATE のDiscord OAuth用Cloudflare Worker
- 大学メールへの認証コード送信
- D1への部員名簿保存・読み戻し
- 部員CSVの読み込み
- 学籍番号から学部・学科・学年を自動判定
- RC/SV/JC別の部員No.自動付与
  - RC: `R1`, `R2`, ...
  - SV: `S1`, `S2`, ...
  - JC: `J1`, `J2`, ...
- S-GATE向けDiscordロール候補の自動判定
  - 部長かつ認証済: `部長`, `[S-GATE] 管理者`, `[S-GATE] 認証済`, `RC`
  - 課長: `課長`, `[S-GATE] 認証済`, `RC`
  - SVかつ認証済: `[S-GATE] 認証済`, `SV`
  - 一般部員かつ認証済: `[S-GATE] 認証済`, `JC`
  - 未認証: `[S-GATE] 未認証`

## CSVヘッダー

```csv
氏名,フリガナ,LINEの名前,学籍番号,大学メール,区分,役職,配属先,認証状態,新歓,第1回,第2回,第3回,第4回,第5回
```

## 学籍番号ルール

`学籍番号ルール.xlsx` をもとに、次のルールで判定しています。

- 1桁目: 学部
- 2,3桁目: 入学年度の下2桁
- 4桁目: 不使用
- 5桁目: 学科
- 6,7,8桁目: 不使用

## 次に作るもの

1. Cloudflare D1などの部員データベース
2. 部員照合API
3. 管理者ログイン
4. CSVインポート結果のDB保存

## S-GATE Worker

ローカル開発では、`wrangler.toml` と同じ階層にある `.env` が読み込まれます。
`.env.example` を参考に `.env` を作成してください。

```sh
npm install
npm run check:setup
npm run dev:worker
```

GitHub Pages側では、`config.js` にデプロイしたWorker URLを設定します。

```js
window.JAMS_CONFIG = {
  sGateBaseUrl: "https://jams-s-gate.example.workers.dev"
};
```

現在のWorkerは、Discord OAuth完了時にサーバー参加を試行し、`[S-GATE] 未認証` ロールを付与します。`S-GATE` がBot自身の管理ロールの場合、人間には付与できないため付与対象から外しています。

その後、大学メールアドレスに認証コードを送信し、D1の `members.email` と照合して認証済みロールへ切り替えます。

### GitHub Pages

GitHub Pagesには、公開用ファイルだけを入れた `docs/` を公開元にします。
リポジトリ直下を公開元にすると、Workerコードや補助スクリプトもURLから見える可能性があるため避けます。

```sh
npm run build:pages
```

GitHubのRepository Settingsから Pages のSourceを `Deploy from a branch` にし、Branchを `main`、Folderを `/docs` に設定します。

PagesのURLが決まったら、Worker側の次の値を本番URLに変更して再デプロイします。

```env
JAMS_FRONTEND_URL=https://ユーザー名.github.io/リポジトリ名/sgate-result.html
JAMS_FRONTEND_ORIGIN=https://ユーザー名.github.io
```

### メール送信

現在はGoogle Apps ScriptのWebアプリを中継して認証コードを送信します。

1. Google Apps Scriptで新しいプロジェクトを作成します。
2. `google-apps-script-mailer.gs` の内容をApps Scriptの `コード.gs` に貼り付けます。
3. Apps Scriptの「プロジェクトの設定」からスクリプトプロパティを追加します。
   - プロパティ: `S_GATE_MAIL_SECRET`
   - 値: 長いランダム文字列
4. Apps ScriptをWebアプリとしてデプロイします。
   - 実行するユーザー: 自分
   - アクセスできるユーザー: 全員
5. 初回実行時にメール送信の権限を承認します。
6. Worker側 `.env` に以下を追加します。

```env
GOOGLE_APPS_SCRIPT_MAIL_URL=https://script.google.com/macros/s/xxxxxxxxxxxxxxxxxxxx/exec
GOOGLE_APPS_SCRIPT_MAIL_SECRET=スクリプトプロパティと同じ長いランダム文字列
```

`S_GATE_EMAIL_FROM` は、メール本文の返信先と送信者名に使います。
実際の送信元アカウントは、Apps ScriptをデプロイしたGoogleアカウントです。

参考:
- [Apps Script MailApp](https://developers.google.com/apps-script/reference/mail/mail-app)
- [Apps Script quotas](https://developers.google.com/apps-script/guides/services/quotas)

Resend API方式は予備としてWorker内に残しています。
さくらレンタルサーバー上の中継PHP方式も予備として `sakura-mail-relay.php` に残しています。

### Cloudflare Email Service

Cloudflare Email Serviceで送信用ドメインを設定し、`wrangler.toml` の `[[send_email]]` binding を使います。
この方式はWorkers Paidプランが必要です。

必要な追加設定:

```env
S_GATE_EMAIL_FROM=情報宣伝部 <info@example.ac.jp>
S_GATE_ALLOWED_EMAIL_DOMAINS=example.ac.jp
```

`S_GATE_ALLOWED_EMAIL_DOMAINS` はカンマ区切りで複数指定できます。

デプロイ時は、既存のDiscord関連値に加えて次のSecrets/VarsをCloudflareに設定します。

```text
S_GATE_EMAIL_FROM
S_GATE_ALLOWED_EMAIL_DOMAINS
S_GATE_SESSION_SECRET
JAMS_FRONTEND_URL
JAMS_FRONTEND_ORIGIN
S_GATE_ADMIN_DISCORD_IDS
DISCORD_ROLE_SV
GOOGLE_APPS_SCRIPT_MAIL_URL
GOOGLE_APPS_SCRIPT_MAIL_SECRET
```

### D1

D1データベースを作成したら、`wrangler.toml` の `database_id` を差し替えます。

```sh
npx wrangler d1 create jams
npm run d1:migrate
```

既にD1を作成済みの場合は、SV追加用のマイグレーションを実行します。

```sh
npx wrangler d1 execute jams --file=worker/migrations/0001_add_sv_committee_type.sql
```

### Deploy

`.env` の値をCloudflare Secretsへまとめて反映するデプロイ用ファイルを作成し、Workerをデプロイします。

```sh
npm run build:secrets
npm run deploy:worker
```

`.cloudflare-secrets.env` は `.gitignore` に含めています。リポジトリにはコミットしないでください。

部員照合には `members.email` が必要です。JAMS画面でCSVを読み込んだあと、管理者は `DB保存` からD1へ名簿を保存できます。保存済み名簿は `DB読込` で画面に読み戻せます。
