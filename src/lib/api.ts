/**
 * Memoreru API Client
 *
 * REST API を呼び出す汎用クライアント。
 * 429 レートリミットの自動リトライ付き。
 */

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

let config: ApiConfig | null = null;

export function configure(cfg: ApiConfig) {
  config = cfg;
}

function getConfig(): ApiConfig {
  if (!config) {
    throw new Error(
      'API not configured. Call configure() first or set MEMORERU_API_KEY environment variable.',
    );
  }
  return config;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { baseUrl, apiKey } = getConfig();
  const maxRetries = 5;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
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
): Promise<{ localPath: string; url: string }> {
  const res = await request<Record<string, unknown>>(
    'POST',
    `/api/sync/upload-image/${contentId}`,
    image,
  );
  return (res.data ?? res) as { localPath: string; url: string };
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

export interface UpsertInput {
  content_id?: string;
  content_type: 'folder' | 'page' | 'table' | 'slide' | 'view' | 'graph' | 'dashboard';
  title: string;
  scope?: 'public' | 'team' | 'private';
  body?: string;
  images?: PushImage[];
  csv_data?: string;
  settings?: Record<string, unknown>;
  description?: string;
  description_expanded?: boolean;
  category?: string;
  label?: string;
  tags?: string[];
  slug?: string;
  thumbnail?: { data: string; mimeType: string };
  emoji?: string;
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
  can_hatena_comment?: boolean;
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
}

export async function upsertContent(input: UpsertInput | Record<string, unknown>): Promise<UpsertResult> {
  const res = await request<Record<string, unknown>>('POST', '/api/sync/upsert', input);
  return (res.data ?? res) as UpsertResult;
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
      for (const [key, value] of Object.entries(row)) {
        if (key === 'row_id' || key === 'display_order' || key === 'cell_settings') continue;
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
  const { baseUrl, apiKey } = getConfig();
  const res = await fetch(`${baseUrl}${imageUrl}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`Image download failed ${res.status}: ${imageUrl}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
