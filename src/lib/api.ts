/**
 * Memoreru API Client
 *
 * REST API を呼び出す汎用クライアント。
 * 429 レートリミットの自動リトライ付き。
 */

export interface ApiConfig {
  baseUrl: string;
  apiKey?: string;
  sessionCookie?: string;
}

let config: ApiConfig | null = null;

export function configure(cfg: ApiConfig) {
  config = cfg;
}

export function getConfig(): ApiConfig {
  if (!config) {
    throw new Error(
      'API not configured. Call configure() first or set MEMORERU_API_KEY environment variable.',
    );
  }
  return config;
}

export function buildAuthHeaders(): Record<string, string> {
  const { apiKey, sessionCookie } = getConfig();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (sessionCookie) {
    headers['Cookie'] = `better-auth.session_token=${sessionCookie}`;
  }
  return headers;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { baseUrl } = getConfig();
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: buildAuthHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429 && attempt < maxRetries) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const retryAfter = (json.retry_after as number) || 30;
      const waitSec = retryAfter + 2;
      console.log(`   ⏳ Rate limited, waiting ${waitSec}s (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
      continue;
    }

    const json = await res.json();
    if (!res.ok) {
      const err = json as Record<string, unknown>;
      throw new Error(`API ${res.status}: ${err.detail ?? err.message ?? JSON.stringify(json)}`);
    }
    return json as T;
  }
  throw new Error('Max retries exceeded for rate limit');
}

// =============================================================================
// Push / Pull / Upsert
// =============================================================================

export interface PushImage {
  localPath: string;
  data: string;
  mimeType: string;
}

export async function pushContent(
  contentId: string,
  body: string,
  images: PushImage[],
  contentType: 'page' | 'slide' = 'page',
) {
  const res = await request<Record<string, unknown>>('POST', `/api/external/sync/push/${contentId}`, {
    contentType,
    body,
    images,
  });
  return (res.data ?? res) as { body: string; uploadedCount: number; skippedCount: number };
}

export async function uploadImage(
  contentId: string,
  image: PushImage,
): Promise<{ localPath: string; url: string; skipped: boolean }> {
  const res = await request<Record<string, unknown>>(
    'POST',
    `/api/external/sync/upload-image/${contentId}`,
    image,
  );
  return (res.data ?? res) as { localPath: string; url: string; skipped: boolean };
}

export interface PullImageMeta {
  memoreruUrl: string;
  localPath: string;
  storagePath: string;
  hash: string | null;
  fileSize: number;
  mimeType: string;
}

export async function pullContent(contentId: string, contentType: 'page' | 'slide' = 'page') {
  const res = await request<Record<string, unknown>>(
    'GET',
    `/api/external/sync/pull/${contentId}?contentType=${contentType}`,
  );
  return (res.data ?? res) as { body: string; images: PullImageMeta[] };
}

// =============================================================================
// 拡張設定（Extensions: スタイル / スクリプト / カスタム処理）
// external canonical API: /api/v1/contents/:contentId/extensions
// =============================================================================

export type ExtensionType = 'style' | 'script' | 'custom_process';

export interface ExtensionRecord {
  extensionId: string;
  contentId: string;
  title: string;
  type: ExtensionType;
  code: string;
  fileName: string | null;
  isDisabled: boolean;
  executionOrder: string | null;
  version: number;
  triggers?: unknown[];
}

export interface CreateExtensionInput {
  title: string;
  type: ExtensionType;
  code?: string;
  fileName?: string;
  isDisabled?: boolean;
  executionOrder?: string;
  triggers?: string[];
}

export interface UpdateExtensionInput {
  version: number;
  title?: string;
  code?: string;
  fileName?: string;
  isDisabled?: boolean;
  executionOrder?: string;
  triggers?: string[];
}

export async function listExtensions(
  contentId: string,
  scriptType?: ExtensionType,
): Promise<ExtensionRecord[]> {
  const res = scriptType
    ? await request<Record<string, unknown>>(
        'GET',
        `/api/v1/contents/${contentId}/extensions?type=${scriptType}`,
      )
    : await request<Record<string, unknown>>(
        'GET',
        `/api/v1/contents/${contentId}/extensions`,
      );
  return ((res.data ?? res) as ExtensionRecord[]) ?? [];
}

export async function createExtension(
  contentId: string,
  input: CreateExtensionInput,
): Promise<ExtensionRecord> {
  const res = await request<Record<string, unknown>>(
    'POST',
    `/api/v1/contents/${contentId}/extensions`,
    input,
  );
  return (res.data ?? res) as ExtensionRecord;
}

export async function updateExtension(
  contentId: string,
  scriptId: string,
  input: UpdateExtensionInput,
): Promise<ExtensionRecord> {
  const res = await request<Record<string, unknown>>(
    'PATCH',
    `/api/v1/contents/${contentId}/extensions/${scriptId}`,
    input,
  );
  return (res.data ?? res) as ExtensionRecord;
}

export async function deleteExtension(contentId: string, scriptId: string): Promise<void> {
  await request('DELETE', `/api/v1/contents/${contentId}/extensions/${scriptId}`);
}

/**
 * 単一 icon の入力（API/sync wire と対称な型タグ付き表現）。
 * - emoji: 絵文字グリフ
 * - image: 事前アップロード参照 `fileId`、または push 時インラインアップロードの `data`(base64)+`mimeType`
 * - null: アイコンをクリア
 */
export type IconInput =
  | { type: 'emoji'; emoji: string }
  | { type: 'image'; fileId?: string; data?: string; mimeType?: string }
  | null;

export interface UpsertInput {
  contentId?: string;
  contentType:
    | 'folder'
    | 'page'
    | 'table'
    | 'slide'
    | 'view'
    | 'graph'
    | 'dashboard'
    | 'screen'
    | 'report'
    | 'workflow';
  title: string;
  scope?: 'public' | 'team' | 'private';
  body?: string;
  images?: PushImage[];
  csvData?: string;
  columnIds?: Record<string, string>;
  columnTypes?: Record<string, string>;
  columnSettings?: Record<string, Record<string, unknown>>;
  deleteColumnIds?: string[];
  rowIds?: Array<string | null>;
  rowVersions?: Array<number | null>;
  /**
   * 照合列 upsert: この列名(or column_id)の値で既存行を照合して update/create する。
   * 指定すると row_id を CSV に持たずにキー一致で冪等更新できる（fresh clone でも動く）。
   */
  matchColumn?: string;
  settings?: Record<string, unknown>;
  description?: string;
  descriptionExpanded?: boolean;
  category?: string;
  label?: string;
  tags?: string[];
  slug?: string;
  thumbnail?: { data: string; mimeType: string };
  /**
   * 単一 icon（絵文字 or 画像）。画像は事前アップロード参照 `fileId` か、push 時インライン
   * アップロードの `data`(base64)+`mimeType`。null でクリア。
   */
  icon?: IconInput;
  // 日時 / 場所は単一 datetime / location のみ（flat date_* / location_* は撤去済み）。
  datetime?: { start?: string | null; end?: string | null; type?: string | null } | null;
  location?: {
    area1?: string | null;
    area2?: string | null;
    lat?: number | null;
    lng?: number | null;
    address?: string | null;
    name?: string | null;
  } | null;
  persons?: string[];
  sources?: string;
  language?: string;
  systemType?: string;
  customOrder?: number;
  teamId?: string;
  parentContentId?: string;
  templateGroupTenantId?: string;
  templateGroupId?: string;
  publishStatus?: 'draft' | 'published';
  scheduledAt?: string;
  expiresAt?: string;
  isSuspended?: boolean;
  isArchived?: boolean;
  discovery?: 'listed' | 'unlisted' | 'profile';
  accessLevel?: 'open' | 'login_required' | 'followers_only';
  canEmbed?: boolean;
  canAiCrawl?: boolean;
  hasPassword?: boolean;
  isPinned?: boolean;
  isLocked?: boolean;
  autoSummary?: boolean;
  autoTranslate?: boolean;
}

export interface UpsertResult {
  contentId: string;
  created: boolean;
  uploadedCount: number;
  skippedCount: number;
  columns?: { columnName: string; columnId: string; columnType: string }[];
  rowIds?: string[];
  rowVersions?: number[];
  conflicts?: { rowId: string; expectedVersion: number; currentVersion: number }[];
}

async function upsertOnce(input: UpsertInput | Record<string, unknown>): Promise<UpsertResult> {
  const res = await request<Record<string, unknown>>('POST', '/api/external/sync/upsert', input);
  return (res.data ?? res) as UpsertResult;
}

/**
 * 1 リクエストあたりの最大データ行数。大きい table の初回 push を分割して
 * body 上限超過 (fetch failed) を避ける。先頭チャンクで作成、後続は同 content_id へ追記。
 * append が既存行を消さないのはサーバ upsert の仕様 (CSV に無い行は削除しない)。
 */
const ROW_CHUNK_SIZE = 500;

/** csv_data の物理行を header / データ行に分解 (CLI は 1 物理行 = 1 行モデル)。 */
function splitCsvRows(csv: string): { header: string; dataRows: string[] } {
  const lines = csv.split('\n');
  return { header: lines[0] ?? '', dataRows: lines.slice(1).filter(l => l.trim() !== '') };
}

/**
 * table コンテンツを push する。データ行が ROW_CHUNK_SIZE を超える場合は複数リクエストに
 * 分割して送る (透過的: 戻り値の row_ids 等は分割前と同じ並びで集約して返す)。
 */
export async function upsertContent(
  input: UpsertInput | Record<string, unknown>
): Promise<UpsertResult> {
  const rec = input as Record<string, unknown>;
  const csv = typeof rec.csvData === 'string' ? rec.csvData : undefined;

  if (rec.contentType !== 'table' || !csv) return upsertOnce(input);

  const { header, dataRows } = splitCsvRows(csv);
  if (dataRows.length <= ROW_CHUNK_SIZE) return upsertOnce(input);

  const rowIds = Array.isArray(rec.rowIds) ? (rec.rowIds as (string | null)[]) : undefined;
  const rowVersions = Array.isArray(rec.rowVersions)
    ? (rec.rowVersions as (number | null)[])
    : undefined;
  // 照合列 upsert モード: 各チャンクは csv_data + match_column を送る (row_id 不要)。
  const matchColumn = typeof rec.matchColumn === 'string' ? rec.matchColumn : undefined;

  const chunkCount = Math.ceil(dataRows.length / ROW_CHUNK_SIZE);
  console.log(
    `   ✂️  ${dataRows.length} 行を ${chunkCount} 分割で push (1 チャンク ${ROW_CHUNK_SIZE} 行)`
  );

  let contentId = typeof rec.contentId === 'string' ? rec.contentId : undefined;
  let created = false;
  let columns: UpsertResult['columns'];
  const allRowIds: string[] = [];
  const allRowVersions: number[] = [];
  const allConflicts: NonNullable<UpsertResult['conflicts']> = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * ROW_CHUNK_SIZE;
    const slice = dataRows.slice(start, start + ROW_CHUNK_SIZE);
    const chunkCsv = [header, ...slice].join('\n');

    let chunkInput: Record<string, unknown>;
    if (i === 0) {
      // 先頭チャンク: 全メタデータ込みで作成/更新し、content_id / columns を確定する。
      chunkInput = { ...rec, csvData: chunkCsv };
      if (rowIds) chunkInput.rowIds = rowIds.slice(start, start + ROW_CHUNK_SIZE);
      if (rowVersions) chunkInput.rowVersions = rowVersions.slice(start, start + ROW_CHUNK_SIZE);
    } else if (matchColumn) {
      // 後続チャンク (照合列): content_id へ match_column で upsert (row_id 不要)。
      chunkInput = {
        contentId,
        contentType: 'table',
        title: rec.title,
        csvData: chunkCsv,
        matchColumn,
      };
      if (rec.columnIds) chunkInput.columnIds = rec.columnIds;
    } else {
      // 後続チャンク (row_id): content_id へ追記。row_ids が無いと既存テーブルで skip されるため、
      // 元の row_ids slice か、新規行なら null 配列を必ず渡して upsert モードに入れる。
      chunkInput = {
        contentId,
        contentType: 'table',
        title: rec.title,
        csvData: chunkCsv,
        rowIds: rowIds ? rowIds.slice(start, start + ROW_CHUNK_SIZE) : slice.map(() => null),
      };
      if (rowVersions) chunkInput.rowVersions = rowVersions.slice(start, start + ROW_CHUNK_SIZE);
      // header→column_id の対応のみ再送 (列は先頭チャンクで作成済。名前照合でも足りるが冪等保険)。
      if (rec.columnIds) chunkInput.columnIds = rec.columnIds;
    }

    const res = await upsertOnce(chunkInput);
    if (i === 0) {
      contentId = res.contentId;
      created = res.created;
      columns = res.columns;
    }
    if (res.rowIds) allRowIds.push(...res.rowIds);
    if (res.rowVersions) allRowVersions.push(...res.rowVersions);
    if (res.conflicts) allConflicts.push(...res.conflicts);
    console.log(`      ✓ チャンク ${i + 1}/${chunkCount} (${slice.length} 行)`);
  }

  return {
    contentId: contentId as string,
    created,
    uploadedCount: 0,
    skippedCount: 0,
    columns,
    rowIds: allRowIds,
    rowVersions: allRowVersions,
    conflicts: allConflicts,
  };
}

// =============================================================================
// Table Pull
// =============================================================================

export interface TableColumn {
  id: string;
  name: string;
  type: string;
}

export async function pullTableData(tableId: string) {
  const colRes = await request<Record<string, unknown>>(
    'GET',
    `/api/v1/contents/tables/${tableId}/columns`,
  );
  const columnData = ((colRes as Record<string, unknown>).data ?? colRes) as Record<string, unknown>;
  const rawColumns = (columnData.columns ?? []) as Record<string, unknown>[];

  const columns: TableColumn[] = rawColumns.map(c => ({
    id: (c.columnId ?? c.id) as string,
    name: (c.displayName ?? c.name) as string,
    type: (c.dataType ?? c.columnType) as string,
  }));

  const idToName = new Map(columns.map(c => [c.id, c.name]));
  const allRows: Record<string, unknown>[] = [];
  let page = 1;
  const limit = 500;

  while (true) {
    const rowRes = await request<Record<string, unknown>>(
      'GET',
      `/api/v1/contents/tables/${tableId}/rows?page=${page}&limit=${limit}`,
    );
    const response = rowRes as Record<string, unknown>;
    const data = (response.data ?? response) as Record<string, unknown>;
    const rawRows = (data.rows ?? []) as Record<string, unknown>[];

    for (const row of rawRows) {
      const converted: Record<string, unknown> = {};
      if (row.rowId) converted.row_id = row.rowId;
      if (row.version != null) converted.version = row.version;
      for (const [key, value] of Object.entries(row)) {
        if (key === 'rowId' || key === 'version' || key === 'displayOrder' || key === 'cellSettings') continue;
        converted[idToName.get(key) ?? key] = value;
      }
      allRows.push(converted);
    }

    const pagination = (response.pagination ?? {}) as Record<string, unknown>;
    const hasMore = pagination.hasMore as boolean | undefined;
    if (!hasMore && rawRows.length < limit) break;
    page++;
  }

  return { columns, rows: allRows };
}

/**
 * テーブルのサーバ側 row_id を全件取得する（prune 用）。
 * pullTableData と同じページングだが row_id のみを集める軽量版。
 */
export async function fetchTableRowIds(tableId: string): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  const limit = 500;
  while (true) {
    const res = (await request<Record<string, unknown>>(
      'GET',
      `/api/v1/contents/tables/${tableId}/rows?page=${page}&limit=${limit}`,
    )) as Record<string, unknown>;
    const data = (res.data ?? {}) as Record<string, unknown>;
    const rawRows = (data.rows ?? []) as Record<string, unknown>[];
    for (const row of rawRows) {
      if (row.rowId) ids.push(String(row.rowId));
    }
    const pagination = (res.pagination ?? {}) as Record<string, unknown>;
    const hasMore = pagination.hasMore as boolean | undefined;
    if (!hasMore && rawRows.length < limit) break;
    page++;
  }
  return ids;
}

/**
 * テーブル行の一括削除（prune 用）。サーバ上限 100/回に合わせてチャンク分割する。
 */
export async function deleteTableRows(tableId: string, rowIds: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < rowIds.length; i += 100) {
    const chunk = rowIds.slice(i, i + 100);
    await request('DELETE', `/api/v1/contents/tables/${tableId}/rows`, { rowIds: chunk });
    deleted += chunk.length;
  }
  return deleted;
}

// =============================================================================
// Content Listing
// =============================================================================

export interface ContentSummary {
  contentId: string;
  title: string;
  contentType: string;
  scope: string;
}

export async function listChildren(folderId: string): Promise<ContentSummary[]> {
  const res = await request<Record<string, unknown>>(
    'GET',
    `/api/v1/contents?parentContentId=${folderId}&limit=100`,
  );
  // 公開 API list レスポンスは `data` が item 配列。
  return ((res as Record<string, unknown>).data as ContentSummary[]) ?? [];
}

export async function listRootContents(mineOnly: boolean): Promise<ContentSummary[]> {
  const params = mineOnly
    ? 'scope=all&limit=100&createdByMe=true'
    : 'scope=all&limit=100';
  const res = await request<Record<string, unknown>>('GET', `/api/v1/contents?${params}`);
  return ((res as Record<string, unknown>).data as ContentSummary[]) ?? [];
}

export async function getTenantInfo(): Promise<{
  slug: string;
  isDefault: boolean;
}> {
  const res = await request<{ slug: string; isDefault: boolean }>('GET', '/api/external/sync/tenant');
  return { slug: res.slug, isDefault: res.isDefault };
}

// =============================================================================
// Image Download
// =============================================================================

export async function downloadImage(imageUrl: string): Promise<Buffer> {
  const { baseUrl } = getConfig();
  const headers = buildAuthHeaders();
  delete headers['Content-Type'];
  const res = await fetch(`${baseUrl}${imageUrl}`, { headers });
  if (!res.ok) throw new Error(`Image download failed ${res.status}: ${imageUrl}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
