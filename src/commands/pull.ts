/**
 * memoreru pull — Memoreru → ローカル
 */

import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { basename, join } from 'path';
import {
  downloadImage,
  getTenantInfo,
  listChildren,
  listRootContents,
  pullContent,
  pullTableData,
} from '../lib/api.js';
import type { ContentSummary } from '../lib/api.js';
import { computeFileHash, readMarkdown, saveImage, writeMarkdown } from '../lib/files.js';
import {
  buildMetaFromEntry,
  getBodyPath,
  readManifest,
  readMeta,
  updateManifestEntry,
  type MemoreruMeta,
} from '../lib/manifest.js';
import { hasRowIdColumn, writeRowIdCsv } from '../lib/row-id-csv.js';
import { scanDirectory } from '../lib/scan.js';
import type { ScanEntry } from '../lib/scan.js';
import { prepareSyncState, readState, writeState, type StateFile } from '../lib/state.js';
import { verifyTenant } from '../lib/tenant.js';

// =============================================================================
// CSV ヘルパー
// =============================================================================

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// =============================================================================
// Settings pull (view/graph/dashboard)
// =============================================================================

async function pullSettings(entry: ScanEntry, isPreview: boolean, projectRoot: string, state: StateFile): Promise<boolean> {
  const { dirPath, fileName, meta } = entry;

  if (!meta.content_id) {
    console.log(`\nℹ️ ${meta.title} — no content_id (not yet pushed)`);
    return true;
  }

  console.log(`\n🤲 ${meta.title} (${meta.content_type})`);

  const result = await pullContent(meta.content_id, meta.content_type as 'page' | 'slide') as {
    settings?: Record<string, unknown>;
    tags?: string[];
    persons?: string[];
    thumbnailUrl?: string | null;
  };

  const settingsPath = fileName ? join(dirPath, fileName) : join(dirPath, 'settings.json');
  const settings = result.settings ?? {};
  console.log(`   ${settingsPath}`);

  if (!isPreview) {
    const jsonBody = JSON.stringify(settings, null, 2) + '\n';
    writeMarkdown(settingsPath, jsonBody);
    if (fileName) {
      const metaUpdates: Record<string, unknown> = {};
      if (result.tags) metaUpdates.tags = result.tags.length > 0 ? result.tags : undefined;
      if (result.persons) metaUpdates.persons = result.persons && result.persons.length > 0 ? result.persons : undefined;
      if (Object.keys(metaUpdates).length > 0) {
        updateManifestEntry(dirPath, fileName, metaUpdates);
        // メモリ上の meta も更新（metaHash の整合性のため）
        Object.assign(meta, metaUpdates);
      }
    }
    if (meta.content_id) {
      prepareSyncState(projectRoot, state, meta.content_id, entry, jsonBody);
    }
  }

  console.log(`   ✅ Settings pulled`);
  return true;
}

// =============================================================================
// テーブル pull
// =============================================================================

async function pullTable(entry: ScanEntry, isPreview: boolean, projectRoot: string, state: StateFile): Promise<boolean> {
  const { dirPath, fileName, meta } = entry;

  if (!meta.content_id) {
    console.log(`\nℹ️ ${meta.title} — no content_id (not yet pushed)`);
    return true;
  }

  console.log(`\n🤲 ${meta.title} (table)`);

  const { columns, rows } = await pullTableData(meta.content_id);
  if (columns.length === 0) {
    console.log('   ℹ️No columns');
    return true;
  }

  // row_id + version を含む CSV を生成
  const rowIds = rows.map(r => String(r.row_id ?? ''));
  const rowVersions = rows.map(r => Number(r.version) || 1);
  const header = columns.map(c => escapeCsvField(c.name)).join(',');
  const dataLines = rows.map(row =>
    columns.map(c => escapeCsvField(String(row[c.name] ?? ''))).join(','),
  );
  const csv = [header, ...dataLines].join('\n') + '\n';

  const csvPath = fileName ? join(dirPath, fileName) : join(dirPath, 'data.csv');
  console.log(`   ${csvPath} (${columns.length} columns, ${rows.length} rows)`);

  if (!isPreview) {
    // 初回のみバックアップ作成（既存ファイルが row_id なしの場合）
    if (existsSync(csvPath) && fileName) {
      const existing = readMarkdown(csvPath);
      if (!hasRowIdColumn(existing)) {
        const bakPath = join(dirPath, fileName.replace(/\.csv$/, '.bak.csv'));
        if (!existsSync(bakPath)) {
          copyFileSync(csvPath, bakPath);
          console.log(`   📋 Backup: ${fileName} → ${basename(bakPath)}`);
        }
      }
    }

    // row_id + version 付き CSV を書き出し
    writeRowIdCsv(csvPath, csv, rowIds, rowVersions);

    if (fileName) {
      updateManifestEntry(dirPath, fileName, {
        columns: columns.map(c => ({ id: c.id, name: c.name, type: c.type })),
      });
    }
    if (meta.content_id) {
      // スナップショットは書き出し後のCSVで保存
      const finalCsv = readMarkdown(csvPath);
      prepareSyncState(projectRoot, state, meta.content_id, entry, finalCsv);
    }
  }

  console.log(`   ✅ Table pulled`);
  return true;
}

// =============================================================================
// Page/Slide pull
// =============================================================================

async function pullSingle(entry: ScanEntry, isPreview: boolean, projectRoot: string, state: StateFile): Promise<boolean> {
  const { dirPath, fileName, meta } = entry;
  const contentType = meta.content_type;

  if (contentType === 'folder') return true;

  if (contentType === 'table') return pullTable(entry, isPreview, projectRoot, state);

  if (contentType === 'view' || contentType === 'graph' || contentType === 'dashboard') {
    return pullSettings(entry, isPreview, projectRoot, state);
  }

  if (contentType !== 'page' && contentType !== 'slide') {
    console.log(`\nℹ️ ${meta.title} (${contentType}) — pull not supported`);
    return true;
  }

  if (!meta.content_id) {
    console.log(`\nℹ️ ${meta.title} — no content_id (not yet pushed)`);
    return true;
  }

  console.log(`\n🤲 ${meta.title} (${contentType})`);

  const result = await pullContent(meta.content_id, contentType as 'page' | 'slide') as {
    body: string;
    images: { memoreruUrl: string; localPath: string; hash: string | null }[];
    tags?: string[];
    persons?: string[];
    thumbnailUrl?: string | null;
  };
  if (!result.body) {
    console.log('   ℹ️Empty body');
    return true;
  }

  const bodyPath = fileName ? join(dirPath, fileName) : getBodyPath(dirPath);
  console.log(`   ${bodyPath}`);

  let downloaded = 0;
  let skipped = 0;

  for (const img of result.images) {
    const localHash = computeFileHash(dirPath, img.localPath);
    if (localHash && localHash === img.hash) {
      skipped++;
      continue;
    }

    if (isPreview) {
      console.log(`   → ${img.localPath} (would download)`);
      continue;
    }

    try {
      const buffer = await downloadImage(img.memoreruUrl);
      saveImage(dirPath, img.localPath, buffer);
      downloaded++;
    } catch (err) {
      console.error(`   ❌${img.localPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  if (!isPreview) {
    writeMarkdown(bodyPath, result.body);

    // thumbnail ダウンロード
    if (result.thumbnailUrl) {
      try {
        const thumbBuffer = await downloadImage(result.thumbnailUrl);
        const thumbPath = './images/thumbnail.webp';
        saveImage(dirPath, thumbPath, thumbBuffer);
        if (fileName) {
          updateManifestEntry(dirPath, fileName, { thumbnail: thumbPath });
        }
      } catch (err) {
        console.error(`   ❌ thumbnail: ${err instanceof Error ? err.message : err}`);
      }
    }

    // tags / persons をマニフェストに書き戻し（空配列=クリアも反映）
    if (fileName && result.tags) {
      const metaUpdates: Record<string, unknown> = {};
      metaUpdates.tags = result.tags.length > 0 ? result.tags : undefined;
      metaUpdates.persons = result.persons && result.persons.length > 0 ? result.persons : undefined;
      updateManifestEntry(dirPath, fileName, metaUpdates);
      // メモリ上の meta も更新（metaHash の整合性のため）
      Object.assign(meta, metaUpdates);
    }

    if (meta.content_id) {
      prepareSyncState(projectRoot, state, meta.content_id, entry, result.body);
    }
  }

  console.log(`   ✅ Images: ${downloaded} downloaded, ${skipped} unchanged`);
  return true;
}

// =============================================================================
// Content resolution
// =============================================================================

function inferFileName(contentType: string, title: string): string {
  const safeName = title.replace(/[/\\:*?"<>|]/g, '_').slice(0, 100);
  switch (contentType) {
    case 'page':
    case 'slide':
      return `${safeName}.md`;
    case 'table':
      return `${safeName}.csv`;
    case 'view':
    case 'graph':
    case 'dashboard':
      return `${safeName}.json`;
    default:
      return safeName;
  }
}

function resolveRemoteContents(
  parentDir: string,
  remoteContents: ContentSummary[],
  isPreview: boolean,
): ScanEntry[] {
  const entries: ScanEntry[] = [];

  // 既存のローカルマッピング構築
  const localMap = new Map<string, { dirPath: string; fileName?: string; meta: MemoreruMeta }>();
  const manifest = readManifest(parentDir);
  if (manifest) {
    for (const [fn, data] of Object.entries(manifest)) {
      const m = buildMetaFromEntry(fn, data);
      if (m.content_id) localMap.set(m.content_id, { dirPath: parentDir, fileName: fn, meta: m });
    }
  }

  for (const remote of remoteContents) {
    const existing = localMap.get(remote.contentId);
    if (existing) {
      entries.push({ dirPath: existing.dirPath, fileName: existing.fileName, meta: existing.meta });
      continue;
    }

    console.log(`   + ${remote.title} (${remote.contentType})`);

    const fileName = remote.contentType === 'folder'
      ? remote.title.replace(/[/\\:*?"<>|]/g, '_').slice(0, 100)
      : inferFileName(remote.contentType, remote.title);

    const meta: MemoreruMeta = {
      content_id: remote.contentId,
      content_type: remote.contentType as MemoreruMeta['content_type'],
      title: remote.title,
    };

    if (!isPreview) {
      if (remote.contentType === 'folder') {
        const folderPath = join(parentDir, fileName);
        if (!existsSync(folderPath)) mkdirSync(folderPath, { recursive: true });
      }
      updateManifestEntry(parentDir, fileName, {
        content_id: remote.contentId,
        content_type: remote.contentType,
        title: remote.title,
      });
    }

    entries.push({ dirPath: parentDir, fileName, meta });
  }

  return entries;
}

// =============================================================================
// Main
// =============================================================================

export async function pullCommand(
  directory: string | undefined,
  options: { preview?: boolean },
) {
  const dir = directory || '.';
  const isPreview = options.preview ?? false;

  console.log(`\n🤲 memoreru pull ${isPreview ? '(preview) ' : ''}${dir}`);
  await verifyTenant();

  const manifest = readManifest(dir);
  const rootMeta = readMeta(dir);
  let entries: ScanEntry[];

  if (manifest) {
    console.log(`\nℹ️Scanning manifest...`);
    entries = scanDirectory(dir);
    console.log(`   Found ${entries.length} content(s) in manifest`);
  } else if (rootMeta && rootMeta.content_type === 'folder') { // 旧形式: 単一コンテンツ .memoreru.json
    console.log(`\nℹ️Fetching children of "${rootMeta.title}"...`);
    const children = await listChildren(rootMeta.content_id!);
    console.log(`   Found ${children.length} child content(s) on Memoreru`);
    entries = [{ dirPath: dir, meta: rootMeta }];
    entries.push(...resolveRemoteContents(dir, children, isPreview));
  } else if (rootMeta) {
    entries = [{ dirPath: dir, meta: rootMeta }];
  } else {
    const tenant = await getTenantInfo();
    const label = tenant.isDefault ? 'your' : 'all';
    console.log(`\nℹ️Fetching ${label} root contents...`);
    const allContents = await listRootContents(tenant.isDefault);
    console.log(`   Found ${allContents.length} content(s) on Memoreru`);
    entries = resolveRemoteContents(dir, allContents, isPreview);
  }

  if (entries.length === 0) {
    console.log('\nℹ️No contents found');
    return;
  }

  console.log(`\nℹ️${entries.length} content(s) to pull`);

  const state = isPreview ? { version: 1 as const, contents: {} } : readState(dir);
  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      const ok = await pullSingle(entry, isPreview, dir, state);
      if (ok) succeeded++;
      else failed++;
    } catch (err) {
      console.error(`   ❌${entry.meta.title}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  // state.json を1回だけ書き込み
  if (!isPreview && succeeded > 0) {
    writeState(dir, state);
  }

  console.log(`\n${isPreview ? 'ℹ️Preview complete' : '✅ Pull complete'}`);
  console.log(`   Succeeded: ${succeeded}`);
  if (failed > 0) console.log(`   Failed: ${failed}`);
}
