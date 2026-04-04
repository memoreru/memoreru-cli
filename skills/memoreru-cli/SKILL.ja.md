---
name: memoreru-cli
description: Memoreru CLI でローカルファイル（Markdown, CSV）と Memoreru を同期する。login でブラウザ認証、keys で API キー管理、init でテンプレート生成、pull でダウンロード、push でアップロード。status で変更確認、diff で差分表示。memoreru, login, logout, keys, init, pull, push, status, diff, コンテンツ同期, ファイル同期, ダウンロード, アップロード, プロファイル, 認証 に関する操作で使用する。
---

# Memoreru CLI

## コマンド

```bash
memoreru login [--profile <name>]
memoreru logout [--profile <name>] [--all]
memoreru keys create [--name <name>] [--read-only] [--profile <name>]
memoreru keys list [--profile <name>]
memoreru keys revoke <prefix> [--profile <name>]
memoreru init [dir] [--type page|table|slide|folder]
memoreru pull [dir] [--preview] [--profile <name>]
memoreru push [dir] [--preview] [--profile <name>]
memoreru status [dir]
memoreru diff [dir] [--file <filename>]
```

認証: `memoreru login` + `memoreru keys create`、または `MEMORERU_API_KEY` 環境変数 / `--api-key` フラグ。status / diff はオフライン動作。

認証の優先順位: `--api-key` > `MEMORERU_API_KEY` > `--profile` > `.memoreru-config.json` > `~/.config/memoreru/credentials.json` の default プロファイル。

## .memoreru.json マニフェスト

```json
{
  "readme.md": { "content_type": "page", "title": "README" },
  "tasks.csv": { "content_type": "table", "title": "タスク一覧" },
  "docs": { "content_type": "folder", "title": "ドキュメント" }
}
```

- `content_type` — **必須**。folder, page, table, slide, view, graph, dashboard
- `content_id` — 初回 push 後に自動書き戻し。手動設定不要
- `columns` — テーブルのみ。push 後に自動設定。`{ id, name, type }` の配列でカラムを一意に識別
- `scope` — public, team, private（デフォルト: private）
- `team_id` — scope が team の場合に必要

その他のプロパティ（日時・場所、公開設定、プライバシー等）は [references/properties.ja.md](references/properties.ja.md) を参照。

**キーのルール:**
- キーはファイル名またはディレクトリ名のみ（パス区切り `/` を含めない）
- `.memoreru.json` に記載したものだけが pull/push の対象になる
- サブディレクトリのコンテンツは、そのディレクトリに別の `.memoreru.json` を置いて定義する

## ファイル形式

- **フォルダ**: サブディレクトリ。中身は自動スキャンされない（子ディレクトリに `.memoreru.json` を置いて明示的に定義する）
- **ページ / スライド**: `.md`。画像は `./images/` に配置、`![alt](./images/file.png)` で参照
- **テーブル**: `.csv`（ヘッダ行 + データ行）。カラム型は自動推定。初回 push 後に `row_id` と `version` 列が先頭に追加される（元ファイルは `.bak.csv` にバックアップ）。2回目以降は変更行のみ送信。version による競合検知で共同編集に対応

## ワークフロー

```bash
# 初回セットアップ
memoreru login
memoreru keys create

# 新規作成 → 編集 → アップロード
memoreru init ./docs --type page
# .md を編集
memoreru status ./docs          # 変更を確認
memoreru diff ./docs            # 差分を確認
memoreru push ./docs

# ダウンロード → 編集 → 再アップロード
memoreru pull ./docs
# .md を編集
memoreru status ./docs          # 変更を確認
memoreru push ./docs
```

## .memoreru-config.json

ディレクトリ単位のプロファイル設定。コンテンツディレクトリに配置して push/pull のプロファイルを自動選択:

```json
{
  "profile": "work"
}
```

## 注意事項

- scope デフォルトは private（意図せず公開されない）
- pull 対応: page, slide, table, folder, view, graph, dashboard
- 画像は push 時に自動アップロード、pull 時にハッシュ差分で効率ダウンロード
- status / diff は `.memoreru/` のスナップショットを使用（`.gitignore` に追加推奨）
- テーブル push は差分送信（変更行のみ）。version 不一致は競合として検知 — `memoreru pull` で解消
- `.bak.csv` はバージョン管理不要なら `.gitignore` に追加
- セッション保存先: `~/.config/memoreru/credentials.json`（パーミッション 600）
