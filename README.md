# JAMS

**JAMS** は、**浜松静大祭実行委員会 情報宣伝部 部員認証・管理システム**です。

略称は **Johsen Authentication & Management System** として扱います。

- **JAMS**: システム全体の名称。部員登録、名簿管理、CSV入出力、D1保存、検索、Discord認証連携を含みます。
- **S-GATE**: Discord認証部分の名称。**Shiha Auth Gate（しぃは認証ゲート）** として扱います。

## 実装範囲

- GitHub Pages で公開できる静的フロントエンド
- 登録、一覧、検索、管理の4メニュー構成
- 部員CSVの読み込み、CSV出力
- D1への部員名簿保存、読み戻し
- 学籍番号から学部・学科・学年を自動判定
- RC/SV/JC別の部員No.自動付与
  - RC: `R1`, `R2`, ...
  - SV: `S1`, `S2`, ...
  - JC: `J1`, `J2`, ...
- S-GATEによるDiscord部員認証
- 大学メールへの認証コード送信
- 認証完了後のDiscordロール付与

## 名称の使い分け

JAMSは、管理画面や部員データ管理を含むシステム全体を指します。

S-GATEは、JAMSの中に含まれるDiscord認証機能だけを指します。APIパス、Discord Slash Command、Discordロール、認証コード画面ではS-GATEを使います。

例:

- JAMS管理画面
- JAMSのCSV登録、一覧、検索、管理
- S-GATE認証コード
- S-GATE管理者
- `[S-GATE] 認証済`
- `/api/sgate/...`

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

## S-GATE認証フロー

現在の主な認証フローは、Discordサーバー内の `/auth` コマンドです。

1. 部員が招待URLからDiscordサーバーに参加します。
2. 未認証ロールで見える認証チャンネルで `/auth` を実行します。
3. Discord上の入力フォームに学籍番号と大学メールを入力します。
4. D1の名簿と照合し、一致した場合は大学メールへ認証コードを送信します。
5. GitHub Pages上のコード入力ページで認証コードを入力します。
6. 正しければ `[S-GATE] 未認証` を外し、`[S-GATE] 認証済`、RC/SV/JC、配属先ロールを付与します。

旧方式として、Discord OAuth開始URLから認証するフローも残しています。万一Slash Command側に問題が出た場合の予備として使えます。

OAuth方式では、Discord OAuth完了時にサーバー参加と `[S-GATE] 未認証` ロール付与を試行します。ただし管理者ログインを妨げないよう、この2つは失敗してもログイン自体は継続します。

## Discordロール判定

JAMSの名簿データから、S-GATE向けDiscordロール候補を自動判定します。

- 部長かつ認証済: `部長`, `[S-GATE] 管理者`, `[S-GATE] 認証済`, `RC`
- 課長: `課長`, `[S-GATE] 認証済`, `RC`
- SVかつ認証済: `[S-GATE] 認証済`, `SV`
- 一般部員かつ認証済: `[S-GATE] 認証済`, `JC`
- 未認証: `[S-GATE] 未認証`

Discordでロールを付与するには、Botのロールを付与対象ロールより上に配置し、Botに「ロールの管理」権限を付けてください。

## GitHub Pages

GitHub Pagesには、公開用ファイルだけを入れた `docs/` を公開元にします。

```sh
npm run build:pages
```

GitHubのRepository Settingsから Pages のSourceを `Deploy from a branch` にし、Branchを `main`、Folderを `/docs` に設定します。

GitHub Pages側では、`config.js` にデプロイしたS-GATE Worker URLを設定します。

```js
window.JAMS_CONFIG = {
  sGateBaseUrl: "https://jams-s-gate.example.workers.dev"
};
```

本番URLが決まったら、Worker側の次の値を設定して再デプロイします。

```env
JAMS_FRONTEND_URL=https://ユーザー名.github.io/リポジトリ名/sgate-result.html
JAMS_FRONTEND_ORIGIN=https://ユーザー名.github.io
```

`sgate-result.html` はDiscord OAuth後の結果表示ページです。`/auth` コマンド後の認証コード入力は `verify.html` に集約しています。

## Cloudflare Worker

ローカル開発では、`wrangler.toml` と同じ階層にある `.env` が読み込まれます。
`.env.example` を参考に `.env` を作成してください。

```sh
npm install
npm run check:setup
npm run dev:worker
```

デプロイ時は、`.env` の値をCloudflare Secretsへまとめて反映するデプロイ用ファイルを作成し、Workerをデプロイします。

```sh
npm run build:secrets
npm run deploy:worker
```

`.cloudflare-secrets.env` は `.gitignore` に含めています。リポジトリにはコミットしないでください。

## Discord Slash Command

Discordの `/auth` コマンドは次のコマンドで登録します。

```sh
npm run discord:commands
```

Discord Developer PortalのInteractions Endpoint URLには次を設定します。

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/discord/interactions
```

## メール送信

現在はGoogle Apps ScriptのWebアプリを中継して認証コードを送信します。

1. Google Apps Scriptで新しいプロジェクトを作成します。
2. `google-apps-script-mailer.gs` の内容をApps Scriptの `コード.gs` に貼り付けます。
3. Apps Scriptの「プロジェクトの設定」からスクリプトプロパティを追加します。
   - 推奨プロパティ: `GOOGLE_APPS_SCRIPT_MAIL_SECRET`
   - 既存互換プロパティ: `S_GATE_MAIL_SECRET`
   - 値: `.env` の `GOOGLE_APPS_SCRIPT_MAIL_SECRET` と同じ長いランダム文字列
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

Resend API方式は予備としてWorker内に残しています。
さくらレンタルサーバー上の中継PHP方式も予備として `sakura-mail-relay.php` に残しています。

## D1

D1データベースを作成したら、`wrangler.toml` の `database_id` を差し替えます。

```sh
npx wrangler d1 create jams
npm run d1:migrate
```

既にD1を作成済みの場合は、SV追加用のマイグレーションを実行します。

```sh
npx wrangler d1 execute jams --file=worker/migrations/0001_add_sv_committee_type.sql --remote
```

部員照合には `members.email` が必要です。JAMS画面でCSVを読み込んだあと、管理者は `DB保存` からD1へ名簿を保存できます。保存済み名簿は `DB読込` で画面に読み戻せます。
