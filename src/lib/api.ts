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
  const res = await request<Record<string, unknown>>('POST', `/api/sync/push/${contentId}`, {
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
    `/api/sync/upload-image/${contentId}`,
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
    `/api/sync/pull/${contentId}?contentType=${contentType}`,
  );
  return (res.data ?? res) as { body: string; images: PullImageMeta[] };
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
  content_id?: string;
  content_type: 'folder' | 'page' | 'table' | 'slide' | 'view' | 'graph' | 'dashboard';
  title: string;
  scope?: 'public' | 'team' | 'private';
  body?: string;
  images?: PushImage[];
  csv_data?: string;
  /**
   * 照合列 upsert: この列名(or column_id)の値で既存行を照合して update/create する。
   * 指定すると row_id を CSV に持たずにキー一致で冪等更新できる（fresh clone でも動く）。
   */
  match_column?: string;
  settings?: Record<string, unknown>;
  description?: string;
  description_expanded?: boolean;
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
  when?: { start?: string | null; end?: string | null; type?: string | null } | null;
  where?: {
    area1?: string | null;
    area2?: string | null;
    lat?: number | null;
    lng?: number | null;
    address?: string | null;
    name?: string | null;
  } | null;
  date_type?: string;
  date_start?: string;
  date_end?: string;
  location_lat?: number;
  location_lng?: number;
  location_address?: string;
  location_name?: string;
  persons?: string[];
  sources?: string;
  language?: string;
  team_id?: string;
  parent_id?: string;
  publish_status?: 'draft' | 'published';
  scheduled_at?: string;
  expires_at?: string;
  is_suspended?: boolean;
  is_archived?: boolean;
  discovery?: 'listed' | 'unlisted' | 'profile';
  access_level?: 'open' | 'login_required' | 'followers_only';
  can_embed?: boolean;
  can_ai_crawl?: boolean;
  has_password?: boolean;
  is_pinned?: boolean;
  is_locked?: boolean;
  auto_summary?: boolean;
  auto_translate?: boolean;
}

export interface UpsertResult {
  content_id: string;
  created: boolean;
  uploadedCount: number;
  skippedCount: number;
  columns?: { column_name: string; column_id: string; column_type: string }[];
  row_ids?: string[];
  row_versions?: number[];
  conflicts?: { row_id: string; expected_version: number; current_version: number }[];
}

async function upsertOnce(input: UpsertInput | Record<string, unknown>): Promise<UpsertResult> {
  const res = await request<Record<string, unknown>>('POST', '/api/sync/upsert', input);
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
  const csv = typeof rec.csv_data === 'string' ? rec.csv_data : undefined;

  if (rec.content_type !== 'table' || !csv) return upsertOnce(input);

  const { header, dataRows } = splitCsvRows(csv);
  if (dataRows.length <= ROW_CHUNK_SIZE) return upsertOnce(input);

  const rowIds = Array.isArray(rec.row_ids) ? (rec.row_ids as (string | null)[]) : undefined;
  const rowVersions = Array.isArray(rec.row_versions)
    ? (rec.row_versions as (number | null)[])
    : undefined;
  // 照合列 upsert モード: 各チャンクは csv_data + match_column を送る (row_id 不要)。
  const matchColumn = typeof rec.match_column === 'string' ? rec.match_column : undefined;

  const chunkCount = Math.ceil(dataRows.length / ROW_CHUNK_SIZE);
  console.log(
    `   ✂️  ${dataRows.length} 行を ${chunkCount} 分割で push (1 チャンク ${ROW_CHUNK_SIZE} 行)`
  );

  let contentId = typeof rec.content_id === 'string' ? rec.content_id : undefined;
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
      chunkInput = { ...rec, csv_data: chunkCsv };
      if (rowIds) chunkInput.row_ids = rowIds.slice(start, start + ROW_CHUNK_SIZE);
      if (rowVersions) chunkInput.row_versions = rowVersions.slice(start, start + ROW_CHUNK_SIZE);
    } else if (matchColumn) {
      // 後続チャンク (照合列): content_id へ match_column で upsert (row_id 不要)。
      chunkInput = {
        content_id: contentId,
        content_type: 'table',
        title: rec.title,
        csv_data: chunkCsv,
        match_column: matchColumn,
      };
      if (rec.column_ids) chunkInput.column_ids = rec.column_ids;
    } else {
      // 後続チャンク (row_id): content_id へ追記。row_ids が無いと既存テーブルで skip されるため、
      // 元の row_ids slice か、新規行なら null 配列を必ず渡して upsert モードに入れる。
      chunkInput = {
        content_id: contentId,
        content_type: 'table',
        title: rec.title,
        csv_data: chunkCsv,
        row_ids: rowIds ? rowIds.slice(start, start + ROW_CHUNK_SIZE) : slice.map(() => null),
      };
      if (rowVersions) chunkInput.row_versions = rowVersions.slice(start, start + ROW_CHUNK_SIZE);
      // header→column_id の対応のみ再送 (列は先頭チャンクで作成済。名前照合でも足りるが冪等保険)。
      if (rec.column_ids) chunkInput.column_ids = rec.column_ids;
    }

    const res = await upsertOnce(chunkInput);
    if (i === 0) {
      contentId = res.content_id;
      created = res.created;
      columns = res.columns;
    }
    if (res.row_ids) allRowIds.push(...res.row_ids);
    if (res.row_versions) allRowVersions.push(...res.row_versions);
    if (res.conflicts) allConflicts.push(...res.conflicts);
    console.log(`      ✓ チャンク ${i + 1}/${chunkCount} (${slice.length} 行)`);
  }

  return {
    content_id: contentId as string,
    created,
    uploadedCount: 0,
    skippedCount: 0,
    columns,
    row_ids: allRowIds,
    row_versions: allRowVersions,
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
    `/api/contents/tables/${tableId}/columns`,
  );
  const rawColumns = ((colRes as Record<string, unknown>).columns ??
    (colRes as Record<string, unknown>).data ?? []) as Record<string, unknown>[];

  const columns: TableColumn[] = rawColumns.map(c => ({
    id: c.id as string,
    name: (c.display_name ?? c.displayName ?? c.name) as string,
    type: (c.data_type ?? c.dataType ?? c.column_type ?? c.columnType) as string,
  }));

  const idToName = new Map(columns.map(c => [c.id, c.name]));
  const allRows: Record<string, unknown>[] = [];
  let page = 1;
  const limit = 500;

  while (true) {
    const rowRes = await request<Record<string, unknown>>(
      'GET',
      `/api/contents/tables/${tableId}/rows?page=${page}&limit=${limit}`,
    );
    const data = rowRes as Record<string, unknown>;
    const rawRows = (data.rows ?? data.data ?? []) as Record<string, unknown>[];

    for (const row of rawRows) {
      const converted: Record<string, unknown> = {};
      if (row.row_id) converted.row_id = row.row_id;
      if (row.version != null) converted.version = row.version;
      for (const [key, value] of Object.entries(row)) {
        if (key === 'row_id' || key === 'version' || key === 'display_order' || key === 'cell_settings') continue;
        converted[idToName.get(key) ?? key] = value;
      }
      allRows.push(converted);
    }

    const hasMore = (data.has_more ?? data.hasMore) as boolean | undefined;
    if (!hasMore && rawRows.length < limit) break;
    page++;
  }

  return { columns, rows: allRows };
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
    `/api/contents?parent_id=${folderId}&limit=100`,
  );
  return ((res as Record<string, unknown>).data as Record<string, unknown>)
    ?.contents as ContentSummary[] ?? [];
}

export async function listRootContents(mineOnly: boolean): Promise<ContentSummary[]> {
  const params = mineOnly
    ? 'scope=all&limit=100&created_by_me=true'
    : 'scope=all&limit=100';
  const res = await request<Record<string, unknown>>('GET', `/api/contents?${params}`);
  return ((res as Record<string, unknown>).data as Record<string, unknown>)
    ?.contents as ContentSummary[] ?? [];
}

export async function getTenantInfo(): Promise<{
  slug: string;
  isDefault: boolean;
}> {
  const res = await request<{ slug: string; isDefault: boolean }>('GET', '/api/sync/tenant');
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
