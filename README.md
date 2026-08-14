# Trip Portal

旅行ごとの費用・旅程・持ち物をまとめるポータルです。

## フォルダ構成

- `app/`: ポータル画面とURLルーティング
- `shikoku-saburo-bbq-2026/`: 2026年9月の四国三郎の郷BBQ旅に固有の画面・計算ロジック

今後、別の旅行を追加するときは、リポジトリ直下に旅行ごとの新しいフォルダを作成します。

## 公開URL

- ポータル: https://tetsu-trip-portal.tetsutetsu369.chatgpt.site
- 四国三郎の郷BBQ旅 費用計算: https://tetsu-trip-portal.tetsutetsu369.chatgpt.site/trips/shikoku-saburo-bbq-2026/budget

## データ保存

入力内容はブラウザの `localStorage` に自動保存されます。DBは使っていません。別の端末へ移す場合やバックアップを残す場合は、画面上部の「バックアップ」「復元」を使います。

