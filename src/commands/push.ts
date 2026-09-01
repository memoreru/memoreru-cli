/**
 * memoreru push — ローカル → Memoreru
 */

import { copyFileSync, existsSync } from 'fs';
import { basename, dirname, join } from 'path';
import {
  deleteTableRows,
  fetchTableRowIds,
  pushContent,
  uploadImage,
  upsertContent,
} from '../lib/api.js';
import { readImageAsBase64, readMarkdown } from '../lib/files.js';
import { updateManifestEntry } from '../lib/manifest.js';
import { pushExtensionsForContent, type ExtensionManifestEntry } from '../lib/extensions-sync.js';
import {
  computeMatchColumnDiff,
  resolveMatchHeaderName,
} from '../lib/match-csv.js';
import {
  computeRowDiff,
  extractRowMeta,
  hasRowIdColumn,
  writeRowIdCsv,
  excludeConflictRowsFromCsv,
} from '../lib/row-id-csv.js';
import type { ScanEntry } from '../lib/scan.js';
import { scanDirectory } from '../lib/scan.js';
import {
  prepareSyncState,
  readSnapshot,
  readState,
  type StateFile,
  writeState,
} from '../lib/state.js';
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
    folder: 0,
    table: 1,
    page: 2,
    slide: 2,
    view: 3,
    graph: 4,
    dashboard: 5,
    screen: 6,
    report: 7,
    workflow: 8,
  };
  return order[type] ?? 2;
}

/**
 * 直近の push で「競合により未反映のまま残った行」があるか。
 * pushSingle が検出し、pushCommand の完了表示で警告するためのフラグ。
 * CLI は 1 プロセス 1 実行なのでモジュールスコープで持つ。
 */
let hasUnresolvedConflicts = false;

async function pushSingle(
  entry: ScanEntry,
  isPreview: boolean,
  projectRoot: string,
  state: StateFile,
  deleteColumnIds: string[] = [],
  prune = false
): Promise<string | null> {
  const { dirPath, fileName, meta } = entry;
  const contentType = meta.content_type;

  console.log(`\n🚀 ${meta.title} (${contentType})`);

  const payload: Record<string, unknown> = {
    contentType,
    title: meta.title,
    scope: meta.scope ?? 'private',
    language: meta.language ?? 'en',
    publishStatus: meta.publish_status ?? 'published',
  };

  // 既存コンテンツの更新
  if (meta.content_id) {
    payload.contentId = meta.content_id;
  }

  // メタデータフィールドをコピー
  const metaFields: Array<[string, string]> = [
    ['description', 'description'],
    ['description_expanded', 'descriptionExpanded'],
    ['slug', 'slug'],
    ['category', 'category'],
    ['label', 'label'],
    // 日時 / 場所は単一 datetime / location のみ送信（flat date_* / location_* は撤去済み）。
    ['datetime', 'datetime'],
    ['location', 'location'],
    ['sources', 'sources'],
    ['system_type', 'systemType'],
    ['custom_order', 'customOrder'],
    ['team_id', 'teamId'],
    ['template_group_tenant_id', 'templateGroupTenantId'],
    ['template_group_id', 'templateGroupId'],
    ['scheduled_at', 'scheduledAt'],
    ['expires_at', 'expiresAt'],
    ['discovery', 'discovery'],
    ['access_level', 'accessLevel'],
    ['can_embed', 'canEmbed'],
    ['can_ai_crawl', 'canAiCrawl'],
    ['has_password', 'hasPassword'],
    ['is_suspended', 'isSuspended'],
    ['is_archived', 'isArchived'],
    ['is_pinned', 'isPinned'],
    ['is_locked', 'isLocked'],
    ['auto_summary', 'autoSummary'],
    ['auto_translate', 'autoTranslate'],
  ];
  for (const [manifestKey, apiKey] of metaFields) {
    if (meta[manifestKey] !== undefined) payload[apiKey] = meta[manifestKey];
  }

  // 配列フィールド（undefined=触らない、[]=クリア、[...]=設定）
  if (Array.isArray(meta.tags)) payload.tags = meta.tags;
  if (Array.isArray(meta.persons)) payload.persons = meta.persons;

  if (entry.parentContentId) payload.parentContentId = entry.parentContentId;

  // Body 読み込み
  let deferredImages: { localPath: string; data: string; mimeType: string }[] = [];
  let rawFileContent: string | undefined; // スナップショット用（ファイルの生の内容）
  let unchangedRows: { rowId: string; version: number }[] = [];
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

      const matchColumn = typeof meta.match_column === 'string' ? meta.match_column : undefined;
      if (matchColumn) {
        // 照合列 upsert: row_id を CSV に持たず、match 列の値で既存行を照合して update/create。
        // スナップショット (前回 push 成功時の CSV) があればキー比較で変更・新規行のみ送る。
        // 無い場合 (fresh clone / 初回) は全行送信。MEMORERU_PUSH_ALL_ROWS=1 で常に全行送信
        // (サーバ側を直接編集した等でスナップショット差分を信頼できないときの escape hatch)。
        // スナップショットに無いキーの削除はここでは行わない (削除同期は呼び出し側の責務)。
        payload.matchColumn = matchColumn;
        const matchSnapshot =
          process.env.MEMORERU_PUSH_ALL_ROWS === '1' || !meta.content_id
            ? null
            : readSnapshot(projectRoot, meta.content_id, 'table');
        const matchHeader = resolveMatchHeaderName(
          matchColumn,
          meta.columns as Array<{ id?: string; name: string }> | undefined,
        );
        const diff = matchSnapshot
          ? computeMatchColumnDiff(csvContent, matchSnapshot, matchHeader)
          : null;
        if (diff) {
          if (diff.changedCount === 0) {
            console.log(`   ℹ️ No row changes detected (match=${matchHeader}, ${diff.unchangedCount} unchanged)`);
          } else {
            console.log(`   📊 ${diff.changedCount} changed, ${diff.unchangedCount} unchanged (match=${matchHeader})`);
          }
          payload.csvData = diff.changedCsv;
        } else {
          payload.csvData = csvContent;
        }
      } else if (hasRowIdColumn(csvContent)) {
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
          payload.csvData = diff.changedCsvData;
          payload.rowIds = diff.changedRowIds;
          payload.rowVersions = diff.changedRowVersions;
          // 未変更行の情報は CSV 書き戻し用にローカルだけで保持する。
          unchangedRows = diff.unchangedRows;
        } else {
          // スナップショットなし → 全行送信
          const { csvData, rowIds, rowVersions } = extractRowMeta(csvContent);
          payload.csvData = csvData;
          payload.rowIds = rowIds;
          payload.rowVersions = rowVersions;
        }
      } else {
        // オリジナル CSV（row_id なし）
        payload.csvData = csvContent;
      }
    }
    // columns があればサーバーに送信（ID書き戻し用 + 型指定用 + 列設定）
    if (Array.isArray(meta.columns) && meta.columns.length > 0) {
      const columns = meta.columns as {
        id?: string;
        name: string;
        type?: string;
        settings?: Record<string, unknown>;
      }[];
      const columnIds = Object.fromEntries(
        columns.filter(c => c.id && c.name).map(c => [c.name, c.id!])
      );
      if (Object.keys(columnIds).length > 0) {
        payload.columnIds = columnIds;
      }
      const columnTypes = Object.fromEntries(
        columns.filter(c => c.type && c.name).map(c => [c.name, c.type!])
      );
      if (Object.keys(columnTypes).length > 0) {
        payload.columnTypes = columnTypes;
      }
      // 列設定（select 選択肢 / required / description）。サーバが key 照合で冪等反映する。
      const columnSettings = Object.fromEntries(
        columns
          .filter(c => c.name && c.settings && typeof c.settings === 'object')
          .map(c => [c.name, c.settings!])
      );
      if (Object.keys(columnSettings).length > 0) {
        payload.columnSettings = columnSettings;
      }
    }
    // 列の明示削除（適用可否はサーバのポリシー/権限に従う。所属外 id は無視される）
    if (deleteColumnIds.length > 0) {
      payload.deleteColumnIds = deleteColumnIds;
    }
  } else if (['view', 'graph', 'dashboard', 'screen', 'report', 'workflow'].includes(contentType)) {
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

  // 単一 icon（絵文字 / 画像 / クリア）。manifest の画像 path は base64 にして送信、
  // emoji / 事前アップロード fileId / null は素通し（undefined=変更しない）。
  const manifestIcon = meta.icon as
    | { type: 'emoji'; emoji: string }
    | { type: 'image'; path?: string; fileId?: string }
    | null
    | undefined;
  if (manifestIcon !== undefined) {
    if (manifestIcon && manifestIcon.type === 'image' && manifestIcon.path) {
      const iconImg = readImageAsBase64(dirPath, manifestIcon.path);
      if (iconImg) {
        payload.icon = { type: 'image', data: iconImg.data, mimeType: iconImg.mimeType };
      }
    } else {
      payload.icon = manifestIcon;
    }
  }

  if (isPreview) {
    const action = meta.content_id ? 'update' : 'create';
    console.log(`   → would ${action}`);
    return meta.content_id ?? 'preview';
  }

  const result = await upsertContent(payload);
  const action = result.created ? 'created' : 'updated';
  console.log(`   ✅ ${action} (${result.contentId})`);

  // 個別アップロードが必要な場合
  if (deferredImages.length > 0) {
    console.log(`   📸 Uploading ${deferredImages.length} image(s) individually...`);
    let convertedBody = payload.body as string;
    for (const img of deferredImages) {
      const { localPath, url, skipped } = await uploadImage(result.contentId, img);
      // Markdown内のローカルパスをAPIパスに置換
      convertedBody = convertedBody.split(`](${localPath})`).join(`](${url})`);
      console.log(skipped ? `   ⏭ ${localPath} (unchanged)` : `   ✓ ${localPath}`);
    }
    // 置換済みbodyをpush（画像なし）
    await pushContent(result.contentId, convertedBody, [], contentType as 'page' | 'slide');
    console.log(`   ✅ Body updated with image URLs`);
  }

  // テーブル: columns を書き戻し（新規・既存問わず）。
  // 列設定 (settings: select 選択肢等) は人間が編集する正本なので、name 照合で保持する。
  if (contentType === 'table' && result.columns && result.columns.length > 0 && fileName) {
    const settingsByName = new Map(
      (Array.isArray(meta.columns) ? meta.columns : [])
        .map(c => c as { name?: string; settings?: Record<string, unknown> })
        .filter(c => c.name && c.settings)
        .map(c => [c.name!, c.settings!])
    );
    const columns = result.columns.map(c => {
      const settings = settingsByName.get(c.columnName);
      const base = { id: c.columnId, name: c.columnName, type: c.columnType };
      return settings ? { ...base, settings } : base;
    });
    updateManifestEntry(dirPath, fileName, { columns });
  }

  // 拡張設定（スタイル/スクリプト/カスタム処理）をローカルファイルから同期。
  // file_name 照合で作成/更新し、script_id を manifest に書き戻す。
  // --prune（または meta.prune）で manifest に無い既存スクリプトを削除。
  if (Array.isArray(meta.extensions) && meta.extensions.length > 0) {
    const updated = await pushExtensionsForContent(
      result.contentId,
      dirPath,
      meta.extensions as ExtensionManifestEntry[],
      { prune: prune || meta.prune === true },
    );
    console.log(`   🧩 Synced ${updated.length} extension(s)`);
    if (fileName) updateManifestEntry(dirPath, fileName, { extensions: updated });
    // メモリ上の meta も更新（後続 prepareSyncState の metaHash 整合）
    Object.assign(meta, { extensions: updated });
  }

  // テーブル: row_id + version 付き CSV で上書き + バックアップ。
  // 照合列 upsert (match_column) では row_id を source に持たないため writeback しない。
  let finalCsvContent: string | undefined;
  if (
    contentType === 'table' &&
    result.rowIds &&
    result.rowIds.length > 0 &&
    fileName &&
    typeof meta.match_column !== 'string'
  ) {
    const csvPath = join(dirPath, fileName);
    const bakPath = join(dirPath, fileName.replace(/\.csv$/, '.bak.csv'));

    // 初回のみバックアップ作成（.bak.csv が未存在の場合）
    if (
      !existsSync(bakPath) &&
      existsSync(csvPath) &&
      rawFileContent &&
      !hasRowIdColumn(rawFileContent)
    ) {
      copyFileSync(csvPath, bakPath);
      console.log(`   📋 Backup: ${fileName} → ${basename(bakPath)}`);
    }

    // 差分pushの場合: 未変更行のID/versionをマージして完全なCSVを再構築
    const allRowIds = [...result.rowIds];
    const allVersions = [...(result.rowVersions ?? result.rowIds.map(() => 1))];

    // 競合行のrow_idセット（ローカルversionを維持するため）
    const conflictRowIds = new Set((result.conflicts ?? []).map(c => c.rowId));

    // 未変更行を末尾に追加（サーバーには送信していないが、CSVには残す必要がある）
    // ただし、未変更行のデータは現在のCSVからそのまま引き継ぐ
    // → 全行のCSVを書き出すために、元のCSVからデータを再構築
    if (unchangedRows.length > 0 && rawFileContent && hasRowIdColumn(rawFileContent)) {
      // 元CSVから全行データを取得
      const originalMeta = extractRowMeta(rawFileContent);
      const originalDataLines = originalMeta.csvData.split('\n');
      const header = originalDataLines[0] ?? '';

      // 変更行のデータ（サーバーに送った分）
      const changedDataLines = (payload.csvData as string).split('\n');
      const changedHeader = changedDataLines[0] ?? '';

      // 変更行と未変更行をrow_id順に再構成
      const rowDataMap = new Map<string, string>();
      // 未変更行: 元CSVからデータ取得
      for (let i = 0; i < originalMeta.rowIds.length; i++) {
        const rid = originalMeta.rowIds[i];
        if (rid) rowDataMap.set(rid, originalDataLines[i + 1] ?? '');
      }
      // 変更行: push結果のデータで上書き（順序は result.row_ids と一致）
      for (let i = 0; i < result.rowIds.length; i++) {
        const rid = result.rowIds[i];
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
            const resultIdx = result.rowIds.indexOf(rid);
            finalVersions.push(
              resultIdx >= 0 && result.rowVersions
                ? result.rowVersions[resultIdx]
                : (originalMeta.rowVersions[i] ?? 1)
            );
          }
          finalDataLines.push(rowDataMap.get(rid)!);
          rowDataMap.delete(rid);
        }
      }
      // 新規行（元CSVにないrow_id）を末尾に追加
      for (const [rid, data] of rowDataMap) {
        finalRowIds.push(rid);
        const resultIdx = result.rowIds.indexOf(rid);
        finalVersions.push(
          resultIdx >= 0 && result.rowVersions ? result.rowVersions[resultIdx] : 1
        );
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
      const csvData = payload.csvData as string;
      writeRowIdCsv(csvPath, csvData, allRowIds, allVersions);
      finalCsvContent = readMarkdown(csvPath);
    }

    // 競合レポート
    if (result.conflicts && result.conflicts.length > 0) {
      for (const c of result.conflicts) {
        console.log(
          `   ⚠️ Conflict: ${c.rowId} (local v${c.expectedVersion}, server v${c.currentVersion}) — skipped`
        );
      }
      console.log(`   → Run 'memoreru pull' to resolve conflicts`);
      // 競合行はサーバーに反映されていない。最終行が成功表示だけだと見落とすため、
      // 未反映が残っていることを明示する
      hasUnresolvedConflicts = true;
    }

    const changedCount = result.rowIds.length - (result.conflicts?.length ?? 0);
    const unchangedCount = unchangedRows.length;
    console.log(
      `   📊 ${changedCount} changed, ${unchangedCount} unchanged${result.conflicts?.length ? `, ${result.conflicts.length} conflicts` : ''}`
    );

  }

  // prune: ローカル CSV に無いサーバ行を削除（全投影テーブルの full-sync）。
  // 変更行の有無に関わらず実行する（version 同期で全行 unchanged でも prune は必要）。
  // 安全策: row_id 列を持つ table のみ（match_column / row_id 無しは全削除事故防止で除外）。
  if (
    (prune || meta.prune === true) &&
    contentType === 'table' &&
    fileName &&
    typeof meta.match_column !== 'string'
  ) {
    const prunePath = join(dirPath, fileName);
    const pruneCsv = existsSync(prunePath) ? readMarkdown(prunePath) : '';
    if (pruneCsv && hasRowIdColumn(pruneCsv)) {
      const localIds = new Set(
        extractRowMeta(pruneCsv).rowIds.filter((r): r is string => !!r)
      );
      if (localIds.size > 0) {
        const serverIds = await fetchTableRowIds(result.contentId);
        const stale = serverIds.filter(id => !localIds.has(id));
        if (stale.length > 0) {
          const n = await deleteTableRows(result.contentId, stale);
          console.log(`   🗑️  prune: ${n} 行を削除（ローカル CSV に無いサーバ行）`);
        } else {
          console.log('   🗑️  prune: 削除対象なし');
        }
      }
    }
  }

  // スナップショット保存（row_id書き戻し後の最終状態で保存）。
  // ただし競合で拒否された行は **サーバーに反映されていない** ので除外する。
  // 含めてしまうと次回の差分計算で「変更なし」と判定され、その行が恒久的に
  // 送られなくなる（push は成功表示で終わるためサイレントに乖離が残る）。
  prepareSyncState(
    projectRoot,
    state,
    result.contentId,
    entry,
    excludeConflictRowsFromCsv(
      finalCsvContent ?? rawFileContent ?? '',
      result.conflicts?.map(conflict => ({ row_id: conflict.rowId })),
    )
  );

  // 新規作成時: content_id をマニフェストに書き戻し
  if (result.created) {
    if (fileName) {
      updateManifestEntry(dirPath, fileName, { content_id: result.contentId });
    } else if (meta.content_type === 'folder') {
      // フォルダは親ディレクトリのマニフェストにキーがある
      const folderName = basename(dirPath);
      const parentDir = dirname(dirPath);
      updateManifestEntry(parentDir, folderName, { content_id: result.contentId });
    }
  }

  // content_id を返す（フォルダの場合、子エントリの parentContentId に使用）
  return result.contentId;
}

export async function pushCommand(
  directory: string | undefined,
  options: { preview?: boolean; deleteColumns?: string; prune?: boolean }
) {
  hasUnresolvedConflicts = false;
  const dir = directory || '.';
  const isPreview = options.preview ?? false;
  // --prune: テーブルで「ローカル CSV に無いサーバ行」を削除する full-sync（全投影 feed 用）
  const doPrune = (options.prune ?? false) && !isPreview;
  // 明示削除する column_id（適用可否はサーバのポリシー/権限に従う）。
  const deleteColumnIds = (options.deleteColumns ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '');

  console.log(`\n🚀 memoreru push ${isPreview ? '(preview) ' : ''}${dir}`);
  if (deleteColumnIds.length > 0) {
    console.log(
      `\n🗑️  --delete-columns: ${deleteColumnIds.join(', ')}\n` +
        '    （明示指定した column_id のみ。適用可否はサーバのポリシーに従う）'
    );
  }
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

      const contentId = await pushSingle(entry, isPreview, dir, state, deleteColumnIds, doPrune);
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
  if (hasUnresolvedConflicts) {
    // 競合行はサーバーに反映されていない。成功表示だけで終えると乖離を見落とす
    console.log(`   ⚠️ 未反映の競合行があります。'memoreru pull' で解決してください`);
  }
}
