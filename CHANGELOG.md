# Changelog

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
