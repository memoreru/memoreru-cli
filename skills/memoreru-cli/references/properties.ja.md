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
| `can_hatena_comment` | boolean | はてなブックマークのコメント許可（デフォルト: `true`） |
| `has_password` | boolean | パスワード保護（デフォルト: `false`） |

## その他

| プロパティ | 型 | 説明 |
|-----------|-----|------|
| `is_pinned` | boolean | ピン留め（デフォルト: `false`） |
| `is_locked` | boolean | 編集不可（デフォルト: `false`） |
| `auto_summary` | boolean | 要約を自動生成（デフォルト: `false`） |
| `auto_translate` | boolean | 翻訳版を自動生成（デフォルト: `false`） |
