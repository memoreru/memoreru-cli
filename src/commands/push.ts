/**
 * memoreru push — ローカル → Memoreru
 */

import { existsSync, copyFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { pushContent, uploadImage, upsertContent } from '../lib/api.js';
import { readImageAsBase64, readMarkdown } from '../lib/files.js';
import { updateManifestEntry } from '../lib/manifest.js';
import { computeRowDiff, extractRowMeta, hasRowIdColumn, writeRowIdCsv } from '../lib/row-id-csv.js';
import { scanDirectory } from '../lib/scan.js';
import type { ScanEntry } from '../lib/scan.js';
import { prepareSyncState, readSnapshot, readState, writeState, type StateFile } from '../lib/state.js';
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

async function pushSingle(entry: ScanEntry, isPreview: boolean, projectRoot: string, state: StateFile): Promise<string | null> {
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
    'discovery', 'access_level', 'can_embed', 'can_ai_crawl', 'has_password',
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
  let rawFileContent: string | undefined; // スナップショット用（ファイルの生の内容）
  if (contentType === 'page' || contentType === 'slide') {
    const bodyPath = fileName ? join(dirPath, fileName) : join(dirPath, 'body.md');
    if (existsSync(bodyPath)) {
      const body = readMarkdown(bodyPath);
      payload.body = body;
      rawFileContent = body;

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
      const csvContent = readMarkdown(csvPath);
      rawFileContent = csvContent;

      if (hasRowIdColumn(csvContent)) {
        // row_id + version 付き CSV → 差分pushを試みる
        const snapshotCsv = meta.content_id
          ? readSnapshot(projectRoot, meta.content_id, 'table')
          : null;

        if (snapshotCsv && hasRowIdColumn(snapshotCsv)) {
          // スナップショットあり → 差分計算
          const diff = computeRowDiff(csvContent, snapshotCsv);
          if (diff.changedRowIds.length === 0) {
            console.log('   ℹ️ No row changes detected');
          }
          payload.csv_data = diff.changedCsvData;
          payload.row_ids = diff.changedRowIds;
          payload.row_versions = diff.changedRowVersions;
          // 未変更行の情報を保持（CSV書き戻し時に必要）
          (payload as Record<string, unknown>)._unchangedRows = diff.unchangedRows;
        } else {
          // スナップショットなし → 全行送信
          const { csvData, rowIds, rowVersions } = extractRowMeta(csvContent);
          payload.csv_data = csvData;
          payload.row_ids = rowIds;
          payload.row_versions = rowVersions;
        }
      } else {
        // オリジナル CSV（row_id なし）
        payload.csv_data = csvContent;
      }
    }
    // columns があればサーバーに送信（ID書き戻し用 + 型指定用）
    if (Array.isArray(meta.columns) && meta.columns.length > 0) {
      const columns = meta.columns as { id?: string; name: string; type?: string }[];
      const columnIds = Object.fromEntries(
        columns.filter(c => c.id && c.name).map(c => [c.name, c.id!])
      );
      if (Object.keys(columnIds).length > 0) {
        payload.column_ids = columnIds;
      }
      const columnTypes = Object.fromEntries(
        columns.filter(c => c.type && c.name).map(c => [c.name, c.type!])
      );
      if (Object.keys(columnTypes).length > 0) {
        payload.column_types = columnTypes;
      }
    }
  } else if (['view', 'graph', 'dashboard'].includes(contentType)) {
    const settingsPath = fileName ? join(dirPath, fileName) : join(dirPath, 'settings.json');
    if (existsSync(settingsPath)) {
      const settingsRaw = readMarkdown(settingsPath);
      payload.settings = JSON.parse(settingsRaw);
      rawFileContent = settingsRaw; // JSON.stringify 再整形ではなく生の内容を保持
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

  // テーブル: columns を書き戻し（新規・既存問わず）
  if (contentType === 'table' && result.columns && result.columns.length > 0 && fileName) {
    const columns = result.columns.map(c => ({
      id: c.column_id,
      name: c.column_name,
      type: c.column_type,
    }));
    updateManifestEntry(dirPath, fileName, { columns });
  }

  // テーブル: row_id + version 付き CSV で上書き + バックアップ
  let finalCsvContent: string | undefined;
  if (contentType === 'table' && result.row_ids && result.row_ids.length > 0 && fileName) {
    const csvPath = join(dirPath, fileName);
    const bakPath = join(dirPath, fileName.replace(/\.csv$/, '.bak.csv'));

    // 初回のみバックアップ作成（.bak.csv が未存在の場合）
    if (!existsSync(bakPath) && existsSync(csvPath) && rawFileContent && !hasRowIdColumn(rawFileContent)) {
      copyFileSync(csvPath, bakPath);
      console.log(`   📋 Backup: ${fileName} → ${basename(bakPath)}`);
    }

    // 差分pushの場合: 未変更行のID/versionをマージして完全なCSVを再構築
    const unchangedRows = ((payload as Record<string, unknown>)._unchangedRows ?? []) as { rowId: string; version: number }[];
    const allRowIds = [...result.row_ids];
    const allVersions = [...(result.row_versions ?? result.row_ids.map(() => 1))];

    // 競合行のrow_idセット（ローカルversionを維持するため）
    const conflictRowIds = new Set((result.conflicts ?? []).map(c => c.row_id));

    // 未変更行を末尾に追加（サーバーには送信していないが、CSVには残す必要がある）
    // ただし、未変更行のデータは現在のCSVからそのまま引き継ぐ
    // → 全行のCSVを書き出すために、元のCSVからデータを再構築
    if (unchangedRows.length > 0 && rawFileContent && hasRowIdColumn(rawFileContent)) {
      // 元CSVから全行データを取得
      const originalMeta = extractRowMeta(rawFileContent);
      const originalDataLines = originalMeta.csvData.split('\n');
      const header = originalDataLines[0] ?? '';

      // 変更行のデータ（サーバーに送った分）
      const changedDataLines = (payload.csv_data as string).split('\n');
      const changedHeader = changedDataLines[0] ?? '';

      // 変更行と未変更行をrow_id順に再構成
      const rowDataMap = new Map<string, string>();
      // 未変更行: 元CSVからデータ取得
      for (let i = 0; i < originalMeta.rowIds.length; i++) {
        const rid = originalMeta.rowIds[i];
        if (rid) rowDataMap.set(rid, originalDataLines[i + 1] ?? '');
      }
      // 変更行: push結果のデータで上書き（順序は result.row_ids と一致）
      for (let i = 0; i < result.row_ids.length; i++) {
        const rid = result.row_ids[i];
        if (rid && changedDataLines[i + 1] !== undefined) {
          rowDataMap.set(rid, changedDataLines[i + 1]);
        }
      }

      // 元CSVの行順 + 新規行 で再構築
      const finalRowIds: string[] = [];
      const finalVersions: number[] = [];
      const finalDataLines: string[] = [header || changedHeader];

      // 元CSVの行順を維持
      for (let i = 0; i < originalMeta.rowIds.length; i++) {
        const rid = originalMeta.rowIds[i];
        if (rid && rowDataMap.has(rid)) {
          finalRowIds.push(rid);
          // 競合行はローカルversionを維持（再pushで競合が持続するように）
          if (conflictRowIds.has(rid)) {
            finalVersions.push(originalMeta.rowVersions[i] ?? 1);
          } else {
            const resultIdx = result.row_ids.indexOf(rid);
            finalVersions.push(resultIdx >= 0 && result.row_versions ? result.row_versions[resultIdx] : (originalMeta.rowVersions[i] ?? 1));
          }
          finalDataLines.push(rowDataMap.get(rid)!);
          rowDataMap.delete(rid);
        }
      }
      // 新規行（元CSVにないrow_id）を末尾に追加
      for (const [rid, data] of rowDataMap) {
        finalRowIds.push(rid);
        const resultIdx = result.row_ids.indexOf(rid);
        finalVersions.push(resultIdx >= 0 && result.row_versions ? result.row_versions[resultIdx] : 1);
        finalDataLines.push(data);
      }

      const csvData = finalDataLines.join('\n');
      writeRowIdCsv(csvPath, csvData, finalRowIds, finalVersions);
      finalCsvContent = readMarkdown(csvPath);
    } else {
      // 差分pushでない場合: そのまま書き出し
      // 競合行はローカルversionを維持
      if (conflictRowIds.size > 0 && rawFileContent && hasRowIdColumn(rawFileContent)) {
        const origMeta = extractRowMeta(rawFileContent);
        for (let i = 0; i < allRowIds.length; i++) {
          if (conflictRowIds.has(allRowIds[i])) {
            const origIdx = origMeta.rowIds.indexOf(allRowIds[i]);
            if (origIdx >= 0) allVersions[i] = origMeta.rowVersions[origIdx] ?? 1;
          }
        }
      }
      const csvData = payload.csv_data as string;
      writeRowIdCsv(csvPath, csvData, allRowIds, allVersions);
      finalCsvContent = readMarkdown(csvPath);
    }

    // 競合レポート
    if (result.conflicts && result.conflicts.length > 0) {
      for (const c of result.conflicts) {
        console.log(`   ⚠️ Conflict: ${c.row_id} (local v${c.expected_version}, server v${c.current_version}) — skipped`);
      }
      console.log(`   → Run 'memoreru pull' to resolve conflicts`);
    }

    const changedCount = result.row_ids.length - (result.conflicts?.length ?? 0);
    const unchangedCount = unchangedRows.length;
    console.log(`   📊 ${changedCount} changed, ${unchangedCount} unchanged${result.conflicts?.length ? `, ${result.conflicts.length} conflicts` : ''}`);
  }

  // スナップショット保存（row_id書き戻し後の最終状態で保存）
  prepareSyncState(projectRoot, state, result.content_id, entry, finalCsvContent ?? rawFileContent ?? '');

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
  const state = isPreview ? { version: 1 as const, contents: {} } : readState(dir);

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

      const contentId = await pushSingle(entry, isPreview, dir, state);
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

  // state.json を1回だけ書き込み
  if (!isPreview && succeeded > 0) {
    writeState(dir, state);
  }

  console.log(`\n${isPreview ? 'ℹ️Preview complete' : '✅ Push complete'}`);
  console.log(`   Succeeded: ${succeeded}`);
  if (failed > 0) console.log(`   Failed: ${failed}`);
}
