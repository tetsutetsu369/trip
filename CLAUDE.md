# 開発メモ

## 本番環境

- 本番URL: https://tetsu-trip-portal.tetsutetsu369.workers.dev/trips/shikoku-saburo-bbq-2026
- ホスティング: Cloudflare Workers（workers.dev）
- 本番Origin: https://tetsu-trip-portal.tetsutetsu369.workers.dev
- デプロイ先: 上記のCloudflare Workers本番Origin

上記のWorkers URLを本番環境の正規URLとして扱う。
公開・デプロイ時は、別のSites公開URLではなく、必ず上記のWorkers URLへ反映する。

## Supabase接続情報

- Supabase Management APIトークンは、プロジェクトルートの`.env.local`に`SUPABASE_ACCESS_TOKEN`として保存されている。
- トークンの値は表示・コミット・チャットへの貼り付けをしない。`.env.local`はGit管理対象外として扱う。
- SQLやDDLを実行するときは、Supabase Management APIを優先して利用する。`SUPABASE_SERVICE_ROLE_KEY`はアプリのData API用であり、Management APIのSQL実行用トークンとして代用しない。
- 対象プロジェクトのrefは`fekseezlcxqczmuzhlqw`。SQL実行後は、マイグレーション履歴・変更した列・RPC関数を読み取り確認する。

## 今回のトラブルシュート記録

- Supabase CLIの初回実行では、既定の`C:\Users\tetsu\.supabase`へテレメトリを書き込めず失敗した。必要時は`SUPABASE_HOME`をワークスペース内の一時ディレクトリへ設定する。
- `SUPABASE_SERVICE_ROLE_KEY`をPostgreSQLのDBパスワードとして使うと認証に失敗した。DB接続用パスワードとManagement API用PATは別物である。
- Management APIのPATで`/v1/projects/{project_ref}/database/query`を使うことで、DBパスワードなしにSQLを適用できた。
- 通常権限では`.git`への書き込みが拒否され、コミット作成に昇格権限が必要だった。
- 既存のHTMLレンダリングテストはルートURLの認証リダイレクト（307）を200想定して失敗した。これは今回の費用機能変更とは別の既存テスト前提である。

## 失敗記録ルール

- 今後、作業中に失敗・阻害・想定外の挙動が発生した場合は、原因・影響・採用した回避策または次の対応を、必ず`CLAUDE.md`と`AGENTS.md`の両方へ同じ内容で追記する。
- トークン、パスワード、APIキーなどの秘密値は失敗記録へ書かず、変数名・保存場所・権限種別だけを記録する。

## 今回の作業メモ

- 数値入力欄の確認時に、PowerShell経由の`rg`検索で正規表現のエスケープを誤り、検索コマンドが構文エラーになった。ファイル変更への影響はなく、検索対象を分けた単純な検索へ切り替えて再確認する。
- ビルド実行時に、このPowerShellセッションのPATHへ`npm`が登録されておらず、`npm run build`を開始できなかった。ソースへの影響はなく、Node.jsの実行ファイル位置を確認して同じビルドを別の呼び出し方で再実行する。
- Node.jsの実体を確認するための広域検索が終了コード1となり、実行ファイルを特定できなかった。ソースへの影響はなく、確認できたDenoまたはプロジェクト内の別の検証手段を使ってビルド確認を続ける。
- Bash経由でNode/npmの有無を確認しようとしたが、WSLのBashサービス起動がアクセス拒否となった。ソースへの影響はなく、Bash経由の確認をやめてDenoで検証する。
- DenoでTypeScript検査を実行したところ、`BudgetPage.tsx`の購入リスト周辺でJSXの閉じタグ不整合が見つかった。数値入力欄の修正時に該当ブロックの構造を崩したため、閉じタグを修正してから再検査する。
- Deno経由のVinextビルドはクライアント変換まで成功したが、Sitesプラグインの最終処理で`C:\Users\tetsu`への`stat`がEPERMとなった。ソースへの影響はなく、実行環境の権限制限と判断し、同じビルドを権限付きで再実行する。
- 生成物検証をDenoの`eval`で代替しようとした際、このDenoのサブコマンドでは通常の権限フラグ形式が使えず開始できなかった。生成物への影響はなく、Denoの正しいフラグ形式を確認して再実行する。
- Denoで既存のHTMLレンダリングテストを実行した際、初回は読み取り許可を付け忘れてテスト開始前に停止した。ソースへの影響はなく、必要な読み取り許可を付けて再実行する。
- 読み取り許可付きで既存のHTMLレンダリングテストを再実行したが、認証リダイレクトの`307`が返り、テストの`200`想定により失敗した。今回のフォーム変更とは無関係の既存テスト前提であり、テストコードは変更せず、TypeScript検査とSitesビルド成功を採用して確認する。
- Sitesソースリポジトリへのpushが通常権限のネットワーク制限で接続できなかった。ローカルコミットへの影響はなく、同じpushをネットワーク権限付きで再試行する。
- ネットワーク権限付きのSitesソースpushは接続できたが、リモート`main`に先行コミットがありnon-fast-forwardで拒否された。リモートを強制上書きせず、履歴を取得して安全に統合できるか確認する。
- Sitesアーカイブ補助ツールの依存コマンド確認で、標準PATHには`grep`と`mktemp`が見つからず確認コマンドが終了した。Git同梱Bashは利用可能なため、公式パッケージスクリプトをGit Bashから実行する。
- Git Bashから公式パッケージスクリプトを実行したが、一時領域作成時に`/c/Users/tetsu`への権限エラーとなった。ソースと生成物への影響はなく、同じスクリプトを権限付きGit Bashで再実行する。
- 本番公開後に正規Workers URLへHTTP確認を行ったが、この実行環境のネットワーク制限でソケット接続が拒否された。Sites側の本番デプロイは成功しており、Workers URLの疎通確認は利用環境から再確認する。
