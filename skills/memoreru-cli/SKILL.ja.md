---
name: memoreru-cli
description: Memoreru CLI でローカルファイル（Markdown, CSV）と Memoreru を同期する。init でテンプレート生成、pull でダウンロード、push でアップロード。status で変更確認、diff で差分表示。memoreru, init, pull, push, status, diff, コンテンツ同期, ファイル同期, ダウンロード, アップロード に関する操作で使用する。
---

# Memoreru CLI

## コマンド

```bash
memoreru init [dir] [--type page|table|slide|folder]
memoreru pull [dir] [--preview]
memoreru push [dir] [--preview]
memoreru status [dir]
memoreru diff [dir] [--file <filename>]
```

認証: `MEMORERU_API_KEY` 環境変数 または `--api-key` フラグ。status / diff は API キー不要（オフライン動作）。

## .memoreru.json マニフェスト

```json
{
  "readme.md": { "content_type": "page", "title": "README" },
  "data.csv": { "content_type": "table", "title": "データ一覧" },
  "docs": { "content_type": "folder", "title": "ドキュメント" }
}
```

- `content_type` — **必須**。folder, page, table, slide, view, graph, dashboard
- `content_id` — 初回 push 後に自動書き戻し。手動設定不要
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
- **テーブル**: `.csv`（ヘッダ行 + データ行）。カラム型は自動推定

## ワークフロー

```bash
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

## 注意事項

- scope デフォルトは private（意図せず公開されない）
- pull 対応: page, slide, table, folder, view, graph, dashboard
- 画像は push 時に自動アップロード、pull 時にハッシュ差分で効率ダウンロード
- status / diff は `.memoreru/` のスナップショットを使用（`.gitignore` に追加推奨）
