# .memoreru.json Properties Reference

## Basic Info

| Property | Type | Description |
|-------|------|-------------|
| `content_id` | string | Memoreru content ID. Auto-set after first push |
| `content_type` | string | **Required.** `folder`, `page`, `table`, `slide`, `view`, `graph`, `dashboard` |
| `title` | string | Title. Inferred from filename if omitted |
| `scope` | string | `public`, `team`, `private` (default: `private`) |
| `description` | string | Description text |
| `description_expanded` | boolean | Show description expanded (default: `false`) |
| `category` | string | Category name or key (e.g., `technology`, `lifestyle`) |
| `label` | string | Label |
| `tags` | string[] | Array of tag names (e.g., `["React", "Tutorial"]`) |
| `slug` | string | Custom URL slug (paid plan) |

## Additional Info

| Property | Type | Description |
|-------|------|-------------|
| `thumbnail` | string | Thumbnail image path (e.g., `./images/thumb.png`) |
| `emoji` | string | Emoji icon (e.g., `📝`) |
| `date_type` | string | `year`, `month`, `date`, `datetime` |
| `date_start` | string | Start date (e.g., `2026`, `2026-01`, `2026-01-15`, `2026-01-15T10:00:00`) |
| `date_end` | string | End date (same format as date_start) |
| `location_lat` | number | Latitude (WGS84) |
| `location_lng` | number | Longitude (WGS84) |
| `location_address` | string | Address |
| `location_name` | string | Location name |
| `persons` | string[] | Array of person names (e.g., `["John Doe"]`) |
| `sources` | string | References |
| `language` | string | ISO 639-1 language code (default: `en`) |

## Publishing

| Property | Type | Description |
|-------|------|-------------|
| `team_id` | string | Team ID (required when scope is team) |
| `parent_id` | string | Parent folder's content_id |
| `publish_status` | string | `draft`, `published` (default: `published`) |
| `scheduled_at` | string | Scheduled publish time (ISO 8601, e.g., `2026-04-01T09:00:00+09:00`) |
| `expires_at` | string | Expiration time (ISO 8601) |
| `is_suspended` | boolean | Suspend content (default: `false`) |
| `is_archived` | boolean | Archive content (default: `false`) |

## Privacy

| Property | Type | Description |
|-------|------|-------------|
| `discovery` | string | `listed` (searchable), `unlisted` (URL only), `profile` (profile only). Default: `listed` |
| `access_level` | string | `open` (anyone), `login_required` (logged-in users), `followers_only` (followers). Default: `open` |
| `can_embed` | boolean | Allow embedding (default: `true`) |
| `can_ai_crawl` | boolean | Allow AI crawlers (default: `true`) |
| `has_password` | boolean | Password protection (default: `false`) |

## Other

| Property | Type | Description |
|-------|------|-------------|
| `is_pinned` | boolean | Pin to top (default: `false`) |
| `is_locked` | boolean | Lock editing (default: `false`) |
| `auto_summary` | boolean | Auto-generate summary (default: `false`) |
| `auto_translate` | boolean | Auto-generate translations (default: `false`) |

## Table Columns (auto-managed)

| Property | Type | Description |
|-------|------|-------------|
| `columns` | object[] | Column definitions (table only). Auto-set after push. Each: `{ id, name, type }`. |

Column IDs ensure unique references from views and graphs. To rename a column, update both the CSV header and `columns[].name`.

## Table CSV Format

After first push, `row_id` and `version` columns are prepended to the CSV. The original is backed up as `.bak.csv`.

| Column | Description |
|--------|-------------|
| `row_id` | Row identifier (auto-assigned, leave empty for new rows) |
| `version` | Optimistic lock version (auto-incremented on each update) |

Only changed rows are sent on push (diff-based). Version mismatch triggers conflict detection.
