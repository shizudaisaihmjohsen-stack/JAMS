# JAMS 引き継ぎ資料

この資料は、浜松静大祭実行委員会 情報宣伝部の次期部長へ、JAMSを引き継ぐためのものです。

JAMSは、情報宣伝部の部員管理、Discord認証、Discordロール付与、部員へのDM送信を行うシステムです。

## 1. まず知っておくこと

JAMSは、次の2つに分けて考えると分かりやすいです。

- JAMS: 部員登録、一覧、検索、管理画面、D1名簿管理を含むシステム全体
- S-GATE: Discord認証機能の名称

管理画面:

```text
https://shizudaisaihmjohsen-stack.github.io/JAMS/
```

部員向け認証URL:

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/sgate/auth
```

Worker稼働確認:

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/health
```

`https://jams-s-gate.shizudaisai-hm.workers.dev` は管理画面ではありません。認証やDiscord連携を処理する裏側のAPIサーバーです。

## 2. システム構成

JAMSは次のサービスで動いています。

| 役割 | サービス |
| --- | --- |
| 管理画面 | GitHub Pages |
| 認証、API、Discord連携 | Cloudflare Workers |
| 部員データベース | Cloudflare D1 |
| Discord参加、ロール付与、DM送信 | Discord Bot |
| 認証コードメール送信 | Google Apps Script |
| ソースコード管理 | GitHub |

## 3. 引き継ぐべきアカウントと権限

次期部長が最低限アクセスできるようにしてください。

### GitHub

- リポジトリ `JAMS` へのアクセス権限
- `main` ブランチへ反映できる権限
- GitHub Pages の設定を確認できる権限

### Cloudflare

- JAMSで使っているCloudflareアカウントへのアクセス権限
- Worker `jams-s-gate` を管理できる権限
- D1データベース `jams` を確認・編集できる権限
- WorkerのSecretsを確認・更新できる権限
- Wrangler CLIでログインできる状態

### Discord

- 情報宣伝部Discordサーバーの管理権限
- Botを管理できる権限
- Botのロール位置を変更できる権限
- Discord Developer Portalで該当アプリを管理できる権限

### Google

- 認証コードメール送信用のGoogle Apps Scriptを管理できる権限
- Apps Script APIを利用できる状態
- Webアプリの再デプロイができる権限

## 4. 絶対にそのまま公開しないもの

次の情報は、引き継ぎ時に共有は必要ですが、READMEや公開リポジトリには書かないでください。

- Discord Bot Token
- Discord Client Secret
- Cloudflare API Token
- Google Apps Script Mail Secret
- `.env`
- `.cloudflare-secrets.env`
- Cloudflare Worker Secrets

共有する場合は、大学/委員会で認められた安全な方法で渡してください。

## 5. 通常運用

### 部員を登録・編集する

1. JAMS管理画面を開く
2. Discordで管理者ログインする
3. 部員情報を登録または編集する
4. 保存するとD1データベースにも反映される

部員No.は区分ごとに自動で付与されます。

- 委員長: `C1`, `C2`, ...
- RC: `R1`, `R2`, ...
- SV: `S1`, `S2`, ...
- JC: `J1`, `J2`, ...

### 部員に認証してもらう

部員には次のURLを案内してください。

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/sgate/auth
```

認証の流れは次の通りです。

1. 部員が認証URLを開く
2. Discord認証を行う
3. BotがDiscordサーバー参加を確認する
4. 部員が学籍番号と静大メールアドレスを入力する
5. 両方がD1上の部員データと一致した場合だけ認証コードが届く
6. 認証コードが正しければ、Discordロール付与を行う
7. Discord在籍とロール付与を確認できた場合だけD1を認証済みにする

現在は、D1だけ認証済みでDiscordに参加していない状態になりにくいようにしています。

### Discord DMを送る

管理画面から、次のDM送信ができます。

- JC全体会未参加者への一括DM
- 選択した部員への個別DM
- Discord IDを直接指定したDM

一括DMは内部的に分割送信されます。Cloudflare Workersのサブリクエスト上限に当たらないよう、複数回のAPI呼び出しに分けて送信します。

送信に失敗した場合は、画面に失敗者と理由が表示されます。

よくある失敗理由:

- 相手がDMを拒否している
- Botがブロックされている
- Discordの送信制限に当たっている
- Discord側の一時的なエラー

## 6. Discord Botで重要な設定

Botが正常に動くには、次の設定が必要です。

- BotがDiscordサーバーに参加している
- Botのロールが、付与対象ロールより上にある
- Botに「ロールの管理」権限がある
- BotにDM送信ができる状態である
- Discord Developer PortalでServer Members IntentがON

Botのロール位置が低いと、認証済みロールやJC/SV/RCロールを付与できません。

SVとJCは、JAMS上で配属先を設定すると担当課ロールも同期されます。配属先を変更した場合は、古い担当課ロールを外し、新しい担当課ロールを付与します。

## 7. よく使う確認URL

### 管理画面

```text
https://shizudaisaihmjohsen-stack.github.io/JAMS/
```

### 認証URL

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/sgate/auth
```

### Worker稼働確認

```text
https://jams-s-gate.shizudaisai-hm.workers.dev/health
```

正常な例:

```json
{
  "ok": true,
  "service": "S-GATE",
  "discordGateway": "connected"
}
```

`discordGateway` が `connecting` や `resuming` の場合は、デプロイ直後なら少し待ってから再確認してください。

## 8. 不具合時の確認手順

### 認証できない

1. 部員が正しい認証URLを開いているか確認する
2. Discord Botがサーバーにいるか確認する
3. Botのロール位置が付与対象ロールより上か確認する
4. Server Members IntentがONか確認する
5. D1の部員データに学籍番号とメールアドレスが正しく登録されているか確認する
6. Workerの `/health` を確認する
7. Cloudflare Worker logsを確認する

### 認証コードメールが届かない

1. 学籍番号と静大メールアドレスが同じ部員データに登録されているか確認する
2. メールアドレスのドメインが許可対象か確認する
3. Google Apps ScriptがWebアプリとして公開されているか確認する
4. Apps Scriptの権限承認が切れていないか確認する
5. Worker Secretsの `GOOGLE_APPS_SCRIPT_MAIL_URL` と `GOOGLE_APPS_SCRIPT_MAIL_SECRET` を確認する

### Discordロールが付かない

1. Botのロール位置を確認する
2. Botに「ロールの管理」権限があるか確認する
3. Cloudflare Worker SecretsにDiscordロールIDが正しく設定されているか確認する
4. 対象者がDiscordサーバーに参加しているか確認する

### DMが送れない

1. 失敗者と理由を管理画面で確認する
2. 相手がDMを拒否していないか確認する
3. Discord側の送信制限に当たっていないか確認する
4. 時間を置いて再送する

## 9. コードを変更して反映する基本手順

Node.jsとWranglerが使える環境で作業します。

```sh
npm install
npm.cmd run test:auth
npm.cmd run build:pages
npx.cmd wrangler deploy --dry-run
npx.cmd wrangler deploy --keep-vars
git add .
git commit -m "変更内容"
git push origin ブランチ名:main
```

Windows PowerShellで `npm` や `npx` が実行できない場合は、`npm.cmd` / `npx.cmd` を使ってください。

## 10. GitHub Pagesを更新する

フロントエンドを変更した場合は、公開用ファイルを `docs/` に反映します。

```sh
npm.cmd run build:pages
git add docs app.js index.html styles.css auth.js auth.html service-worker.js
git commit -m "Update JAMS pages"
git push origin ブランチ名:main
```

反映後、管理画面を開いて表示を確認してください。

PWAやブラウザキャッシュの影響で古い画面が残る場合があります。その場合は、ブラウザ更新、PWA再起動、またはservice workerのキャッシュ名更新が必要です。

## 11. Cloudflare D1の確認例

本番D1の人数確認:

```sh
npx.cmd wrangler d1 execute jams --remote --command "SELECT COUNT(*) AS total FROM members;"
```

認証状況の確認:

```sh
npx.cmd wrangler d1 execute jams --remote --command "SELECT COUNT(*) AS total, SUM(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) AS verified, SUM(CASE WHEN verified_at IS NULL THEN 1 ELSE 0 END) AS unverified FROM members;"
```

注意: D1を直接編集する場合は、必ず対象者と変更内容を確認してから実行してください。

## 12. 退任前チェックリスト

退任前に、次の項目を次期部長と一緒に確認してください。

- 次期部長がJAMS管理画面にログインできる
- 次期部長がGitHubリポジトリにアクセスできる
- 次期部長がCloudflare WorkerとD1を確認できる
- 次期部長がDiscord Developer PortalのBot設定を確認できる
- 次期部長がGoogle Apps Scriptを確認できる
- BotがDiscordサーバーにいる
- `/health` が `connected` を返す
- S-GATE認証URLを開くとDiscord認証に進む
- テスト用に1人へDM送信できる
- 重要なSecretsの保管場所と更新方法を次期部長が理解している

## 13. 緊急時の考え方

JAMSで問題が起きたときは、まず次の順に切り分けてください。

1. 管理画面だけの問題か
2. Worker/APIの問題か
3. D1データの問題か
4. Discord Botの権限や状態の問題か
5. Google Apps Scriptのメール送信の問題か

迷った場合は、最初に `/health`、Cloudflare Worker logs、Discord Botのロール位置、D1の `members` テーブルを確認すると原因に近づきやすいです。

## 14. AIに相談するときの注意

JAMSのREADME、引き継ぎ資料、管理画面URL、認証URL、ソースコードをAIに読ませるだけでは、通常は管理者以外が勝手にJAMSを操作することはできません。

JAMSの管理APIは、Discordでログインした管理者セッションを要求します。また、WorkerやD1を直接操作するにはCloudflare権限が必要です。そのため、URLやソースコードを知っているだけでは、部員データの編集、認証状態の変更、DM送信などの管理操作はできません。

ただし、次の情報や環境をAIに渡すと、管理者と同じ操作ができる可能性があります。

- `.env`
- `.cloudflare-secrets.env`
- Discord Bot Token
- Discord Client Secret
- Cloudflare API Token
- Google Apps Script Mail Secret
- Cloudflare、GitHub、Discordにログイン済みのブラウザ操作権限
- Wrangler CLIでCloudflareにログイン済みのPC操作権限
- 管理者としてログイン済みのJAMS画面やCookie

AIに相談するときは、原則としてSecretsを削除したコードやエラーメッセージだけを渡してください。ログイン済みブラウザやCLIをAIに操作させる場合は、何をしてよいかを明確に指定し、操作後に変更内容を確認してください。

退任時や管理者交代時には、不要になった管理者権限を削除し、必要に応じてBot Token、Cloudflare API Token、Google Apps Script Mail Secretを再発行してください。
