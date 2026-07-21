# JAMS

**JAMS** は、**浜松静大祭実行委員会 情報宣伝部 部員認証・管理システム**です。

略称は **Johsen Authentication & Management System** として扱います。

- **JAMS**: システム全体の名称。部員登録、D1名簿管理、検索、Discord認証連携を含みます。
- **S-GATE**: Discord認証部分の名称。**Shiha Auth Gate（しぃは認証ゲート）** として扱います。

## 実装範囲

- GitHub Pages で公開できる静的フロントエンド
- 登録、一覧、検索、DM、管理の5メニュー構成
- D1を使用した部員名簿の登録、編集、削除
- JC全体会の欠席者または選択した部員へのDiscord DM送信
- しぃはBot宛に届いたDiscord DMの管理者限定閲覧
- 学籍番号から学部・学科・学年を自動判定
- 委員長/RC/SV/JC別の部員No.自動付与
  - 委員長: `C1`, `C2`, ...
  - RC: `R1`, `R2`, ...
  - SV: `S1`, `S2`, ...
  - JC: `J1`, `J2`, ...
- S-GATEによるDiscord部員認証
- 大学メールへの認証コード送信
- 認証完了後のDiscordロール付与

## 引き継ぎ資料

次期部長へ渡す資料と設定例は `handover/` にまとめています。まず `handover/00_README.md` と `handover/HANDOVER.md` を確認してください。

## 名称の使い分け

JAMSは、管理画面や部員データ管理を含むシステム全体を指します。

S-GATEは、JAMSの中に含まれるDiscord認証機能だけを指します。APIパス、Discordロール、認証コード画面ではS-GATEを使います。

例:

- JAMS管理画面
- JAMSの部員登録、一覧、検索、管理
- S-GATE認証コード
- S-GATE管理者
- `[S-GATE] 認証済`
- `/api/sgate/...`

## 学籍番号ルール

`学籍番号ルール.xlsx` をもとに、次のルールで判定しています。

- 1桁目: 学部
- 2,3桁目: 入学年度の下2桁
- 4桁目: 不使用
- 5桁目: 学科
- 6,7,8桁目: 不使用

## S-GATE認証フロー

現在の主な認証フローは、S-GATEのDiscord OAuth開始URLから直接認証に進む方式です。OAuthの各開始試行はD1へ個別に保存されるため、リンクの二重クリックや複数タブでも相互に上書きされません。

1. 部員がS-GATE認証リンクを開くと、Workerが一回限りのOAuth stateと戻り先をD1へ保存します。
2. Discordで認可後、Workerがstateを一度だけ消費し、Discordサーバーへの参加を試行・確認します。
3. JAMSへ戻るための一回限りの引き継ぎトークンを発行し、ブラウザセッションへ交換します。
4. 既に認証済みなら、本人確認を繰り返さずDiscord表示名とロールを再同期して完了します。
5. 未認証なら、JAMS上で学籍番号と大学メールを入力し、D1の名簿と照合します。
6. 大学メールへ届いたコードが正しければ本人確認を確定し、Discord表示名とロールを同期します。

認証コードの確認後、Discordサーバー在籍と必要ロールの付与を確認できた場合だけD1を認証済みに更新します。Discord API障害、サーバー未参加、ロール階層の問題などで付与を確認できない場合は未認証のままとなり、問題解消後に再試行できます。既に認証済みの部員が認証リンクを開いた場合は、Discord表示名とロールを再同期します。

S-GATE認証リンク（部員向け）:

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/sgate/auth
```

JAMS管理画面（管理者向け）:

```text
https://shizudaisaihmjohsen-stack.github.io/JAMS/
```

認証専用画面は `auth.html`、管理画面は `index.html` に分離されています。認証リンクから管理画面へ遷移することはありません。

管理者向けの保守機能として、Discord IDを直接指定するDM送信、しぃはBot宛DMの受信箱、特例の手動認証、Discord Gatewayの状態確認・再接続APIを残しています。いずれも管理者セッションが必要です。

## Discordロール判定

JAMSの名簿データから、S-GATE向けDiscordロール候補を自動判定します。

- 部長かつ認証済: `部長`, `[S-GATE] 管理者`, `[S-GATE] 認証済`, `RC`
- 課長: `課長`, `[S-GATE] 認証済`, `RC`
- SVかつ認証済: `[S-GATE] 認証済`, `SV`, 配属先ロール
- 一般部員かつ認証済: `[S-GATE] 認証済`, `JC`, 配属先ロール
- 未認証: `[S-GATE] 未認証`

配属先が設定されている場合は、SV/JCともに担当課ロールも同期します。配属先を変更した場合は、保存後に古い担当課ロールを外し、新しい担当課ロールを付与します。

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
JAMS_FRONTEND_URL=https://ユーザー名.github.io/リポジトリ名/
JAMS_FRONTEND_ORIGIN=https://ユーザー名.github.io
```

Discord OAuth後は、部員向け認証では `auth.html`、管理者ログインではJAMS本体の `index.html` に戻ります。

## Cloudflare Worker

ローカル開発では、`wrangler.toml` と同じ階層にある `.env` が読み込まれます。
本番の必須シークレットと同名の値を `.env` に設定してください。必要なキーは `npm run check:setup` で確認できます。

```sh
npm install
npm run check:setup
npm run test:auth
npm run dev:worker
```

認証フローv2の初回デプロイでは、必ずD1移行、Worker、GitHub Pagesの順に反映します。`d1:migrate:auth-v2` は一度だけ実行します。
認証フローは `email_verification_challenges` 表を使用します。旧 `email_verification_codes` 表は移行完了後に `0010_drop_legacy_email_verification_codes.sql` で削除済みです。

```sh
npm run test:auth
npm run d1:migrate:auth-v2
npm run build:secrets
npm run deploy:worker
npm run build:pages
```

`.cloudflare-secrets.env` は `.gitignore` に含めています。リポジトリにはコミットしないでください。

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

部員No.の重複防止を有効にする場合は、既存の重複を解消してから次を実行します。

```sh
npm run d1:migrate:member-no
```

部員照合には `members.email` が必要です。管理者がJAMS画面で登録・編集した内容は、その都度D1へ保存されます。
