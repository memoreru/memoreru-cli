/**
 * memoreru push — ローカル → Memoreru
 */

import { existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import { pushContent, uploadImage, upsertContent } from '../lib/api.js';
import { readImageAsBase64, readMarkdown } from '../lib/files.js';
import { updateManifestEntry } from '../lib/manifest.js';
import { scanDirectory } from '../lib/scan.js';
import type { ScanEntry } from '../lib/scan.js';
import { verifyTenant } from '../lib/tenant.js';

/** Markdown から画像パスを抽出 */
function extractLocalPaths(markdown: string): string[] {
  const regex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const path = match[2];
    if (!path.startsWith('http') && !path.startsWith('data:') && !path.startsWith('/api/')) {
      paths.push(path);
    }
  }
  return paths;
}

/** push 時のソート優先度 */
function typePriority(type: string): number {
  const order: Record<string, number> = {
    folder: 0, table: 1, page: 2, slide: 2,
    view: 3, graph: 4, dashboard: 5,
  };
  return order[type] ?? 2;
}

async function pushSingle(entry: ScanEntry, isPreview: boolean): Promise<string | null> {
  const { dirPath, fileName, meta } = entry;
  const contentType = meta.content_type;

  console.log(`\n🚀 ${meta.title} (${contentType})`);

  const payload: Record<string, unknown> = {
    content_type: contentType,
    title: meta.title,
    scope: meta.scope ?? 'private',
    language: meta.language ?? 'en',
    publish_status: meta.publish_status ?? 'published',
  };

  // 既存コンテンツの更新
  if (meta.content_id) {
    payload.content_id = meta.content_id;
  }

  // メタデータフィールドをコピー
  const metaFields = [
    'description', 'description_expanded', 'emoji', 'slug', 'category', 'label',
    'date_type', 'date_start', 'date_end',
    'location_lat', 'location_lng', 'location_address', 'location_name',
    'sources', 'system_type', 'custom_order', 'team_id',
    'scheduled_at', 'expires_at',
    'discovery', 'access_level', 'can_embed', 'can_ai_crawl', 'can_hatena_comment', 'has_password',
    'is_suspended', 'is_archived', 'is_pinned', 'is_locked', 'auto_summary', 'auto_translate',
  ];
  for (const key of metaFields) {
    if (meta[key] !== undefined) payload[key] = meta[key];
  }

  // 配列フィールド（undefined=触らない、[]=クリア、[...]=設定）
  if (Array.isArray(meta.tags)) payload.tags = meta.tags;
  if (Array.isArray(meta.persons)) payload.persons = meta.persons;

  if (entry.parentContentId) payload.parent_id = entry.parentContentId;

  // Body 読み込み
  let deferredImages: { localPath: string; data: string; mimeType: string }[] = [];
  if (contentType === 'page' || contentType === 'slide') {
    const bodyPath = fileName ? join(dirPath, fileName) : join(dirPath, 'body.md');
    if (existsSync(bodyPath)) {
      const body = readMarkdown(bodyPath);
      payload.body = body;

      // 画像収集
      const images = [];
      for (const localPath of extractLocalPaths(body)) {
        const img = readImageAsBase64(dirPath, localPath);
        if (img) images.push({ localPath, ...img });
      }

      // base64合計サイズで判定（3MB以上 → 個別アップロード）
      const totalSize = images.reduce((sum, img) => sum + img.data.length, 0);
      const INDIVIDUAL_THRESHOLD = 3 * 1024 * 1024;

      if (totalSize >= INDIVIDUAL_THRESHOLD) {
        // 画像はupsert後に個別アップロード
        deferredImages = images;
      } else if (images.length > 0) {
        payload.images = images;
      }
    }
  } else if (contentType === 'table') {
    const csvPath = fileName ? join(dirPath, fileName) : join(dirPath, 'data.csv');
    if (existsSync(csvPath)) {
      payload.csv_data = readMarkdown(csvPath);
    }
  } else if (['view', 'graph', 'dashboard'].includes(contentType)) {
    const settingsPath = fileName ? join(dirPath, fileName) : join(dirPath, 'settings.json');
    if (existsSync(settingsPath)) {
      payload.settings = JSON.parse(readMarkdown(settingsPath));
    }
  }

  // サムネイル
  if (meta.thumbnail && typeof meta.thumbnail === 'string') {
    const thumbImg = readImageAsBase64(dirPath, meta.thumbnail);
    if (thumbImg) {
      payload.thumbnail = { data: thumbImg.data, mimeType: thumbImg.mimeType };
    }
  }

  if (isPreview) {
    const action = meta.content_id ? 'update' : 'create';
    console.log(`   → would ${action}`);
    return meta.content_id ?? 'preview';
  }

  const result = await upsertContent(payload);
  const action = result.created ? 'created' : 'updated';
  console.log(`   ✅ ${action} (${result.content_id})`);

  // 個別アップロードが必要な場合
  if (deferredImages.length > 0) {
    console.log(`   📸 Uploading ${deferredImages.length} image(s) individually...`);
    let convertedBody = payload.body as string;
    for (const img of deferredImages) {
      const { localPath, url, skipped } = await uploadImage(result.content_id, img);
      // Markdown内のローカルパスをAPIパスに置換
      convertedBody = convertedBody.split(`](${localPath})`).join(`](${url})`);
      console.log(skipped ? `   ⏭ ${localPath} (unchanged)` : `   ✓ ${localPath}`);
    }
    // 置換済みbodyをpush（画像なし）
    await pushContent(result.content_id, convertedBody, [], contentType as 'page' | 'slide');
    console.log(`   ✅ Body updated with image URLs`);
  }

  // 新規作成時: content_id をマニフェストに書き戻し
  if (result.created) {
    if (fileName) {
      updateManifestEntry(dirPath, fileName, { content_id: result.content_id });
    } else if (meta.content_type === 'folder') {
      // フォルダは親ディレクトリのマニフェストにキーがある
      const folderName = basename(dirPath);
      const parentDir = dirname(dirPath);
      updateManifestEntry(parentDir, folderName, { content_id: result.content_id });
    }
  }

  // content_id を返す（フォルダの場合、子エントリの parentContentId に使用）
  return result.content_id;
}

export async function pushCommand(
  directory: string | undefined,
  options: { preview?: boolean },
) {
  const dir = directory || '.';
  const isPreview = options.preview ?? false;

  console.log(`\n🚀 memoreru push ${isPreview ? '(preview) ' : ''}${dir}`);
  await verifyTenant();

  const entries = scanDirectory(dir);

  if (entries.length === 0) {
    console.log('\nℹ️No content found. Run: memoreru init');
    return;
  }

  // 依存順にソート（フォルダ → テーブル → page/slide → view → graph → dashboard）
  entries.sort((a, b) => typePriority(a.meta.content_type) - typePriority(b.meta.content_type));

  console.log(`\nℹ️${entries.length} content(s) to push`);

  // フォルダ push 後の content_id マップ（dirPath → content_id）
  const folderContentIds = new Map<string, string>();

  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      // フォルダ push で取得した content_id を子エントリに伝播
      if (!entry.parentContentId && entry.meta.content_type !== 'folder') {
        for (const [folderPath, folderId] of folderContentIds) {
          if (entry.dirPath.startsWith(folderPath)) {
            entry.parentContentId = folderId;
            break;
          }
        }
      }

      const contentId = await pushSingle(entry, isPreview);
      if (contentId) {
        succeeded++;
        // フォルダの content_id を記録
        if (entry.meta.content_type === 'folder') {
          folderContentIds.set(entry.dirPath, contentId);
        }
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`   ❌${entry.meta.title}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(`\n${isPreview ? 'ℹ️Preview complete' : '✅ Push complete'}`);
  console.log(`   Succeeded: ${succeeded}`);
  if (failed > 0) console.log(`   Failed: ${failed}`);
}
