/**
 * memoreru keys create / list / revoke コマンド
 *
 * セッション認証（credentials.json のクッキー）を使って API キーを管理する。
 * 既存の POST/GET/DELETE /api/external/v1/api-keys エンドポイントを呼び出す。
 */

import { getConfig, buildAuthHeaders } from '../lib/api.js';

type ApiKeyCreateResponse = {
  id: string;
  name: string;
  key: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
};

type ApiKeyListItem = Omit<ApiKeyCreateResponse, 'key'> & { lastUsedAt: string | null };

export function normalizeApiKey(key: ApiKeyCreateResponse | ApiKeyListItem) {
  return {
    id: key.id,
    name: key.name,
    key: 'key' in key ? key.key : undefined,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes ?? [],
    lastUsedAt: 'lastUsedAt' in key ? key.lastUsedAt : null,
    createdAt: key.createdAt,
  };
}

export function createApiKeyRequest(name: string, scopes: string[]): { name: string; scopes: string[] } {
  return { name, scopes };
}

// ---------------------------------------------------------------------------
// ヘルパー: 認証付きリクエスト（レスポンス status にアクセスする用途）
// ---------------------------------------------------------------------------

async function sessionRequest<T>(method: string, path: string, body?: unknown): Promise<{ res: Response; data: T }> {
  const { baseUrl } = getConfig();

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: buildAuthHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({})) as T;
  return { res, data };
}

// ---------------------------------------------------------------------------
// keys create
// ---------------------------------------------------------------------------

export async function keysCreateCommand(options: {
  name?: string;
  readOnly?: boolean;
  profile?: string;
}) {
  const name = options.name || `CLI ${new Date().toISOString().slice(0, 10)}`;
  const scopes = options.readOnly ? ['api:read'] : ['api:read', 'api:write'];

  try {
    const { res, data } = await sessionRequest<{
      status: string;
      data?: ApiKeyCreateResponse;
      detail?: string;
      message?: string;
    }>('POST', '/api/external/v1/api-keys', createApiKeyRequest(name, scopes));

    if (!res.ok) {
      const msg = (data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `HTTP ${res.status}`;
      console.error(`\n❌ APIキーの作成に失敗しました: ${msg}`);
      process.exit(1);
    }

    const key = normalizeApiKey(data.data!);
    console.log(`\n✅ APIキーを作成しました`);
    console.log();
    console.log(`   ${key.key}`);
    console.log();
    console.log(`   名前:           ${key.name}`);
    console.log(`   スコープ:       ${key.scopes.join(', ')}`);
    console.log(`   プレフィックス: ${key.keyPrefix}`);
    console.log();
    console.log(`   ⚠️ このキーは一度しか表示されません。安全な場所に保存してください。`);
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// keys list
// ---------------------------------------------------------------------------

export async function keysListCommand(options: { profile?: string }) {
  try {
    const { res, data } = await sessionRequest<{
      status: string;
      data?: { keys: ApiKeyListItem[] };
      detail?: string;
      message?: string;
    }>('GET', '/api/external/v1/api-keys');

    if (!res.ok) {
      const msg = (data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `HTTP ${res.status}`;
      console.error(`\n❌ APIキー一覧の取得に失敗しました: ${msg}`);
      process.exit(1);
    }

    const keys = (data.data?.keys ?? []).map(normalizeApiKey);
    if (keys.length === 0) {
      console.log('\n   APIキーはありません。');
      return;
    }

    console.log();
    for (const key of keys) {
      const date = key.createdAt.slice(0, 10);
      const scopes = key.scopes.join(', ');
      console.log(`   ${key.keyPrefix.padEnd(10)} ${key.name.padEnd(20)} ${scopes.padEnd(22)} ${date}`);
    }
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// keys revoke
// ---------------------------------------------------------------------------

export async function keysRevokeCommand(prefix: string, options: { profile?: string }) {
  try {
    // まず一覧を取得してプレフィックスから ID を解決
    const { res: listRes, data: listData } = await sessionRequest<{
      data?: { keys: ApiKeyListItem[] };
    }>('GET', '/api/external/v1/api-keys');

    if (!listRes.ok) {
      console.error(`\n❌ APIキー一覧の取得に失敗しました。`);
      process.exit(1);
    }

    const keys = (listData.data?.keys ?? []).map(normalizeApiKey);
    const target = keys.find(k => k.keyPrefix === prefix || k.id === prefix);
    if (!target) {
      console.error(`\n❌ プレフィックス '${prefix}' に一致するAPIキーが見つかりません。`);
      process.exit(1);
    }

    const { res } = await sessionRequest('DELETE', `/api/external/v1/api-keys/${target.id}`);

    if (!res.ok) {
      console.error(`\n❌ APIキーの無効化に失敗しました (${res.status})`);
      process.exit(1);
    }

    console.log(`\n✅ APIキー '${target.name}' (${target.keyPrefix}) を無効化しました`);
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
