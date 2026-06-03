# .memoreru.json プロパティ詳細

## 基本情報

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `content_id` | string | Memoreru 側の ID。初回 push 後に自動設定 |
| `content_type` | string | **必須**。`folder`, `page`, `table`, `slide`, `view`, `graph`, `dashboard` |
| `title` | string | タイトル。省略時はファイル名から推定 |
| `scope` | string | `public`, `team`, `private`（デフォルト: `private`） |
| `description` | string | 説明文 |
| `description_expanded` | boolean | 説明を展開表示する（デフォルト: `false`） |
| `category` | string | カテゴリ名またはキー（例: `テクノロジー`, `technology`） |
| `label` | string | ラベル |
| `tags` | string[] | タグ名の配列（例: `["React", "チュートリアル"]`） |
| `slug` | string | カスタムURL スラッグ（有料プラン） |

## 追加情報

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `thumbnail` | string | サムネイル画像のパス（例: `./images/thumb.png`） |
| `emoji` | string | 絵文字アイコン（例: `📝`） |
| `date_type` | string | `year`, `month`, `date`, `datetime` |
| `date_start` | string | 開始日時（例: `2026`, `2026-01`, `2026-01-15`, `2026-01-15T10:00:00`） |
| `date_end` | string | 終了日時（date_start と同じ形式） |
| `location_lat` | number | 緯度（WGS84） |
| `location_lng` | number | 経度（WGS84） |
| `location_address` | string | 住所 |
| `location_name` | string | 場所名 |
| `persons` | string[] | 人物名の配列（例: `["田中太郎"]`） |
| `sources` | string | 参考文献 |
| `language` | string | ISO 639-1 言語コード（デフォルト: `en`） |

## 公開設定

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `team_id` | string | チームID（scope が team の場合に必要） |
| `parent_id` | string | 親フォルダの content_id |
| `publish_status` | string | `draft`, `published`（デフォルト: `published`） |
| `scheduled_at` | string | 予約公開日時（ISO 8601。例: `2026-04-01T09:00:00+09:00`） |
| `expires_at` | string | 公開期限（ISO 8601） |
| `is_suspended` | boolean | 一時停止（デフォルト: `false`） |
| `is_archived` | boolean | アーカイブ（デフォルト: `false`） |

## プライバシー

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `discovery` | string | `listed`（検索可能）, `unlisted`（URL共有のみ）, `profile`（プロフィールのみ）。デフォルト: `listed` |
| `access_level` | string | `open`（誰でも）, `login_required`（ログインユーザー）, `followers_only`（フォロワーのみ）。デフォルト: `open` |
| `can_embed` | boolean | 埋め込み許可（デフォルト: `true`） |
| `can_ai_crawl` | boolean | AIクローラー許可（デフォルト: `true`） |
| `has_password` | boolean | パスワード保護（デフォルト: `false`） |

## その他

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `is_pinned` | boolean | ピン留め（デフォルト: `false`） |
| `is_locked` | boolean | 編集不可（デフォルト: `false`） |
| `auto_summary` | boolean | 要約を自動生成（デフォルト: `false`） |
| `auto_translate` | boolean | 翻訳版を自動生成（デフォルト: `false`） |

## テーブルカラム（自動管理）

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `columns` | object[] | カラム定義（table のみ）。push 後に `id`/`type` が自動設定。各要素: `{ id, name, type, settings? }`。 |

カラムIDにより、ビュー・グラフからの参照が一意に保たれます。カラム名を変更する場合は、CSV ヘッダーと `columns[].name` を両方更新してください。

### `columns[].settings`（列設定・任意）

CSV だけでは表現できない列設定を `settings` で宣言できます（push 時にサーバへ反映）。

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `required` | boolean | 必須入力フラグ（新規列作成時に適用） |
| `description` | string | 列の説明文（新規列作成時に適用） |
| `options` | object[] | `select` / `multi_select` の選択肢。`{ key, value, color?, description? }` |

`options[]` の各要素:

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `key` | string | **必須**。システム保存値（列内で一意の安定キー）。env を跨いで不変 |
| `value` | string | 表示値 |
| `color` | string | バッジ色（プリセット色名 `gray`/`red`/`orange`/`yellow`/`green`/`blue`/`indigo`/`purple`/`pink`、または `#RRGGBB`） |
| `description` | string | 選択肢の補助説明 |

選択肢は `key` 照合で**冪等反映**されます（option_id はサーバ生成。マニフェストには保存しません）。
push のたびに `options` の内容へ同期され、宣言から消えた `key` は削除されます。

```json
{
  "id": "...",
  "name": "ステータス",
  "type": "select",
  "settings": {
    "required": true,
    "description": "商談の進捗段階",
    "options": [
      { "key": "negotiating", "value": "商談中", "color": "blue" },
      { "key": "won", "value": "受注", "color": "green" },
      { "key": "lost", "value": "失注", "color": "gray" }
    ]
  }
}
```

## テーブル CSV 形式

初回 push 後、CSV に `row_id` と `version` 列が先頭に追加されます。元ファイルは `.bak.csv` にバックアップされます。

| 列 | 説明 |
|----|------|
| `row_id` | 行ID（自動付与。新規行は空のまま） |
| `version` | 楽観的ロック用バージョン（更新ごとに自動インクリメント） |

push 時は変更行のみ送信（差分push）。version 不一致で競合を検知します。
