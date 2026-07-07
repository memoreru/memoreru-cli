# Changelog

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
