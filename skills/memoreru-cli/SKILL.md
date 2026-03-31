---
name: memoreru-cli
description: Memoreru CLI syncs local files (Markdown, CSV) with Memoreru. Init to generate templates, pull to download, push to upload. Use for memoreru, init, pull, push, content sync, file sync, download, upload operations. Status to check changes, diff to review before pushing.
---

# Memoreru CLI

## Commands

```bash
memoreru init [dir] [--type page|table|slide|folder]
memoreru pull [dir] [--preview]
memoreru push [dir] [--preview]
memoreru status [dir]
memoreru diff [dir] [--file <filename>]
```

Auth: `MEMORERU_API_KEY` env var or `--api-key` flag. Status and diff work offline without an API key.

## .memoreru.json Manifest

```json
{
  "readme.md": { "content_type": "page", "title": "README" },
  "data.csv": { "content_type": "table", "title": "Data" },
  "docs": { "content_type": "folder", "title": "Documentation" }
}
```

- `content_type` — **Required.** folder, page, table, slide, view, graph, dashboard
- `content_id` — Auto-set after first push. No manual setup needed
- `scope` — public, team, private (default: private)
- `team_id` — Required when scope is team

See [references/properties.md](references/properties.md) for all properties (when/where, publishing, privacy, etc.).

**Key rules:**
- Keys must be file or directory names only (no path separators `/`)
- Only items listed in `.memoreru.json` are pulled/pushed
- Define subdirectory content by placing a separate `.memoreru.json` in that directory

## File Formats

- **Folder**: Subdirectory. Contents are not auto-scanned (place `.memoreru.json` in child directories to explicitly define)
- **Page / Slide**: `.md`. Place images in `./images/`, reference as `![alt](./images/file.png)`
- **Table**: `.csv` (header row + data rows). Column types are auto-inferred

## Workflow

```bash
# Create → edit → upload
memoreru init ./docs --type page
# Edit the .md file
memoreru status ./docs          # Check what changed
memoreru diff ./docs            # Review diffs
memoreru push ./docs

# Download → edit → re-upload
memoreru pull ./docs
# Edit the .md file
memoreru status ./docs          # Check what changed
memoreru push ./docs
```

## Notes

- Default scope is private (no accidental public exposure)
- Pull supports: page, slide, table, folder, view, graph, dashboard
- Images: auto-uploaded on push, hash-based diff download on pull
- Status/diff use `.memoreru/` snapshots (add to `.gitignore`)
