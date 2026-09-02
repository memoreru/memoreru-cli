# Changelog

## 1.5.0 (2026-09-02)

### Changed（サーバー側の API camelCase 化に追随）

- **CLI が送受信する public / external API のキー名を camelCase に変更しました**。
  `content_id` / `csv_data` / `row_ids` などの API 通信キーは、`contentId` /
  `csvData` / `rowIds` などを使用します。
- **重要**: 本バージョンは camelCase 化後の Memoreru サーバーでのみ動作します。旧バージョンの
  CLI を新サーバーに接続すると同期できなくなるため、`npm install -g @memoreru-sdk/cli@latest`
  で更新してください。`.memoreru.json` マニフェストのキーも camelCase に統一しました。
  既存の `content_id`、`content_type` などは `contentId`、`contentType` などへ手動で
  書き換えてください。旧形式は警告して同期対象から除外します。CSV の `row_id` は変更ありません。

### Fixed

- **差分 table push が失敗する問題を修正しました**。CSV の未変更行情報を API リクエストへ
  含めず、ローカルの CSV 書き戻し処理でのみ保持するようにしました。

## 1.4.0 (2026-08-09)

### Changed（サーバー側の API 再編に追随）

- **CLI が呼び出すコンテンツ操作の URL を変更しました**。Memoreru 本体の公開 API が
  バージョン付きのパスへ移行したことに追随します。従来の URL は本体側で廃止される
  ため、**本バージョンは移行後のサーバーが前提**です:
  - `/api/contents/*` → `/api/v1/contents/*` (コンテンツ一覧 / テーブルの列・行 / 拡張設定)
  - `/api/external/*` は変更ありません (first-party 契約のため不変)
- **重要**: 本バージョンは移行後の Memoreru サーバーでのみ動作します。旧サーバーに
  接続すると 404 になります。逆に旧バージョンの CLI (〜1.3.0) を移行後のサーバーで
  使うと動作しないため、`npm install -g @memoreru-sdk/cli@latest` で更新してください。

### Fixed

- **競合で拒否された行が次回以降送られなくなる問題を修正しました**。push は
  ローカルスナップショットとの差分で送信対象を決めますが、スナップショットの保存が
  プッシュ結果に関わらず「ローカルの最終状態」だったため、楽観ロック競合で
  サーバーに拒否された行まで「送信済み」として記録されていました。以降その行は
  「変更なし」と判定され、push は成功表示で終わるため乖離がサイレントに残り続けます。
  拒否された行はスナップショットから除外し「未送信」の状態を保つようにしました
- push の完了表示に、未反映の競合が残っている場合の警告を追加しました
  (成功表示だけだと見落とすため)

## 1.3.0 (2026-07-21)

### Changed（サーバー側の API 再編に追随）

- **CLI が呼び出す API の URL を変更しました**。Memoreru 本体で API 層を「契約」で
  再編したことに追随します。従来の URL は本体側で廃止されるため、**本バージョンは
  再編後のサーバーが前提**です:
  - `/api/sync/*` → `/api/external/sync/*` (push / pull / upsert)
  - `/api/settings/api-keys` → `/api/external/api-keys` (`memoreru keys`)
  - `/api/cli-auth/exchange` → `/api/external/cli-auth/exchange` (`memoreru login`)
- **重要**: 本バージョンは再編後の Memoreru サーバーでのみ動作します。旧サーバーに
  接続すると 404 になります。逆に旧バージョンの CLI (〜1.2.0) を再編後のサーバーで
  使うと動作しないため、`npm install -g @memoreru-sdk/cli@latest` で更新してください。

## 1.2.0 (2026-07-07)

### Changed

- **match_column 方式のテーブル push が差分送信になりました**。照合列の値で
  前回 push 成功時のスナップショットと比較し、変更・新規行のみを送信します
  (大型テーブルの push が大幅に高速化)。次の場合は従来どおり全行送信に
  フォールバックします: スナップショット無し (初回 / fresh clone)、ヘッダの変更、
  照合列の値が空または重複、環境変数 `MEMORERU_PUSH_ALL_ROWS=1` (サーバー側を
  直接編集した後などに全行送信を強制する escape hatch)
- スナップショットに無いキーの行削除は行いません (行削除の同期は呼び出し側の運用)

## 1.1.0 (2026-07-03)

### Changed

- **push する markdown 本文から先頭の YAML frontmatter を除去するようになりました**。
  frontmatter はツール向けのメタデータとして扱われ、ページ本文には含まれません
  (1 行目が `---` で閉じの `---` 単独行がある場合のみ。本文中の水平線は影響を受けません)。
  あわせて本文の改行コードを LF に正規化します

## 1.0.0 (2026-07-02)

初回メジャーリリース。

### Added

- 拡張設定(Extensions)スクリプトのファイルパス同期: manifest の `extensions[]` で
  スタイル/スクリプトを push / pull できます

### Changed

- サーバー API の変更に追従: スクリプト API の content-level パス化
  (`/api/contents/:id/scripts`)、list / pull レスポンスの snake_case、
  日時・場所の送信キー (`datetime` / `location`)

### Fixed

- スクリプト同期の不具合一括修正 (prune / 冪等性 / status 検出 / pull 対称性 / schema drift)
- 拡張同期の status 誤検知と `is_disabled` が収束しない更新を修正
