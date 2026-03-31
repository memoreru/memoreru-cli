# Memoreru CLI

[日本語](README.ja.md)

Sync local Markdown, CSV, and JSON files with [Memoreru](https://memoreru.com) — your content knowledge base.

## ✨ Features

- 🐣 **Init** — Generate project templates
- 🤲 **Pull** — Download Memoreru content to local files
- 🚀 **Push** — Upload local files to Memoreru
- 🚦 **Status** — Show local changes since last sync
- 🔍 **Diff** — Show file-level diffs before pushing
- 🖼️ **Images** — Auto-upload on push, download only changes on pull
- 🏷️ **Rich Metadata** — Categories, tags, thumbnails, dates, locations, and more
- 🤖 **Claude Code** — CLI skill and MCP for AI-assisted workflows

## 🪄 Quick Start

```bash
# No install required
npx @memoreru-sdk/cli --help

# Or install globally
npm install -g @memoreru-sdk/cli
```

## 🌱 Setup

### 1. Get an API Key

1. Log in to [Memoreru](https://memoreru.com)
2. Go to **Settings > Security > API Keys**
3. Create a key with **Read + Write** access

> 💡 API keys require the Light plan or above. A 14-day free trial is available.

### 2. Set Your API Key

```bash
export MEMORERU_API_KEY=your-api-key
```

Or use the `--api-key` flag:

```bash
memoreru --api-key your-api-key pull ./my-data
```

That's it! Now you can use `memoreru init`, `memoreru pull` and `memoreru push`.

## 💡 Usage

### Init

```bash
memoreru init ./my-page                  # Page (default)
memoreru init ./my-table --type table    # Table
memoreru init ./my-folder --type folder  # Folder
```

### Pull

```bash
memoreru pull                    # Pull to current directory
memoreru pull ./my-data          # Pull to specific directory
memoreru pull ./my-data --preview  # Preview without writing
```

Supported types:
- **Folder** → directory structure
- **Page / Slide** → `.md` (images → `images/`)
- **Table** → `.csv`
- **View / Graph / Dashboard** → `.json`

> ⚠️ View / Graph / Dashboard settings contain internal IDs. Pull/push works within the same environment but not across different environments.

### Push

```bash
memoreru push                    # Push from current directory
memoreru push ./my-data          # Push from specific directory
memoreru push ./my-data --preview  # Preview without uploading
```

### Status

Show local changes since the last pull or push.

```bash
memoreru status                  # Show changes in current directory
memoreru status ./my-data        # Show changes in specific directory
```

```
  memoreru status

  Modified:
    M  readme.md (page) "Project README" [body]

  New (not yet pushed):
    +  new-page.md (page) "New Page"

  2 content(s): 1 modified, 1 new
```

No API key required — works entirely offline.

### Diff

Show unified diffs for modified files.

```bash
memoreru diff                          # Show all diffs
memoreru diff --file readme.md         # Show diff for a specific file
```

```diff
diff --git a/readme.md b/readme.md
--- a/readme.md
+++ b/readme.md
@@ -3,7 +3,7 @@
 ## Section 1

-Old content
+New content

 ## Section 2
```

No API key required — compares against locally stored snapshots. Output is `git apply` compatible.

## 🎯 File Structure

The CLI uses `.memoreru.json` manifests. **Only listed items** are synced.

```
my-project/
├── .memoreru.json          # Manifest
├── .memoreru/              # Sync state (auto-generated, add to .gitignore)
├── readme.md               # Page
├── members.csv             # Table
├── docs/                   # Folder
│   ├── .memoreru.json      # Manifest for docs/
│   └── guide.md
└── images/
    └── logo.png            # Referenced from Markdown
```

> ⚠️ Keys are file or directory names only. Folder contents are **not** auto-uploaded — place a `.memoreru.json` in each subdirectory.
>
> 💡 Add `.memoreru/` to your `.gitignore` — it stores sync snapshots for `status` and `diff`, not source content.

### .memoreru.json

```json
{
  "readme.md": {
    "content_type": "page",
    "title": "Project README"
  },
  "members.csv": {
    "content_type": "table",
    "title": "Members"
  },
  "docs": {
    "content_type": "folder",
    "title": "Documentation"
  }
}
```

After the first push, `content_id` is automatically written back:

```json
{
  "readme.md": {
    "content_id": "q589jor87vmbnyylb8091cik",
    "content_type": "page",
    "title": "Project README"
  }
}
```

### Properties

Only `content_type` is required. All other properties are optional.

<details>
<summary><strong>Basic Info</strong></summary>

| Property | Description |
|-------|-------------|
| `content_id` | Auto-set after first push |
| `content_type` | **Required.** `folder`, `page`, `table`, `slide`, `view`, `graph`, `dashboard` |
| `title` | Inferred from filename if omitted |
| `scope` | `public`, `team`, `private` (default: `private`) |
| `description` | Description text |
| `description_expanded` | Show expanded (default: `false`) |
| `category` | Category name or key |
| `label` | Label |
| `tags` | Tag names (e.g., `["React", "Tutorial"]`) |
| `slug` | Custom URL slug (paid plan) |

</details>

<details>
<summary><strong>Additional Info</strong></summary>

| Property | Description |
|-------|-------------|
| `thumbnail` | Image path (e.g., `./images/thumb.png`) |
| `emoji` | Emoji icon |
| `date_type` | `year`, `month`, `date`, `datetime` |
| `date_start` | Start date (e.g., `2026-01-15`) |
| `date_end` | End date |
| `location_lat` | Latitude |
| `location_lng` | Longitude |
| `location_address` | Address |
| `location_name` | Location name |
| `persons` | Person names (e.g., `["John Doe"]`) |
| `sources` | References |
| `language` | Language code (default: `en`) |

</details>

<details>
<summary><strong>Publishing</strong></summary>

| Property | Description |
|-------|-------------|
| `team_id` | Team ID (required when scope is `team`) |
| `parent_id` | Parent folder's content_id |
| `publish_status` | `draft` or `published` (default: `published`) |
| `scheduled_at` | Scheduled publish time (ISO 8601) |
| `expires_at` | Expiration time (ISO 8601) |
| `is_suspended` | Suspend (default: `false`) |
| `is_archived` | Archive (default: `false`) |

</details>

<details>
<summary><strong>Privacy</strong></summary>

| Property | Description |
|-------|-------------|
| `discovery` | `listed`, `unlisted`, `profile` (default: `listed`) |
| `access_level` | `open`, `login_required`, `followers_only` (default: `open`) |
| `can_embed` | Allow embedding (default: `true`) |
| `can_ai_crawl` | Allow AI crawlers (default: `true`) |
| `can_hatena_comment` | Allow Hatena Bookmark comments (default: `true`) |
| `has_password` | Password protection (default: `false`) |

</details>

<details>
<summary><strong>Other</strong></summary>

| Property | Description |
|-------|-------------|
| `is_pinned` | Pin to top (default: `false`) |
| `is_locked` | Lock editing (default: `false`) |
| `auto_summary` | Auto-generate summary (default: `false`) |
| `auto_translate` | Auto-generate translations (default: `false`) |

</details>

### Table CSV

```csv
Name,Age,Email
John Doe,30,john@example.com
Jane Smith,25,jane@example.com
```

Column types are auto-inferred on push.

### Images

```markdown
![Screenshot](./images/screenshot.png)
```

- **Pull**: Download only changes
- **Push**: Upload automatically

## 🎨 Options

```
--api-key <key>   API key (overrides MEMORERU_API_KEY)
--help            Show help
--version         Show version
```

**Environment variables:**

| Variable | Description |
|----------|-------------|
| `MEMORERU_API_KEY` | API key |
| `MEMORERU_TENANT` | Tenant slug for verification (recommended for dedicated tenants) |
| `MEMORERU_URL` | Base URL (default: `https://memoreru.com`) |

> 💡 **Dedicated tenant users:** Set `MEMORERU_TENANT` to prevent accidental pushes to the wrong tenant. The CLI verifies the tenant before each pull/push and stops if it doesn't match.

## 🤖 Claude Code Integration

Combine with [Claude Code](https://claude.ai/code) to manage content using natural language.

**CLI Skill (File Sync)** — Teach Claude Code how to use pull/push:

```bash
cp -r node_modules/@memoreru-sdk/cli/skills/memoreru-cli ~/.claude/skills/
```

**MCP (Data Operations)** — Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "memoreru": {
      "url": "https://memoreru.com/api/mcp/",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

**When to use which:**
- ⚡ **CLI** — File-based sync with Git version control
- 🔌 **MCP** — Direct data operations (add rows, search, update)

## 🧩 Programmatic API

```typescript
import { configure, pullContent, pullTableData, upsertContent } from '@memoreru-sdk/cli';
import type { UpsertInput } from '@memoreru-sdk/cli';

configure({
  baseUrl: 'https://memoreru.com',
  apiKey: 'your-api-key',
});

const page = await pullContent('q589jor87vmbnyylb8091cik');
const table = await pullTableData('dyn8dapi7ckz8vvic8indjnc');

const input: UpsertInput = {
  content_type: 'page',
  title: 'My Page',
  body: '# Hello',
};
const result = await upsertContent(input);
```

## 🛸 License

MIT

---

Made with ❤️ for knowledge creators

Sync your content, own your workflow!
