/**
 * memoreru keys create / list / revoke コマンド
 *
 * セッション認証（credentials.json のクッキー）を使って API キーを管理する。
 * 既存の POST/GET/DELETE /api/settings/api-keys エンドポイントを呼び出す。
 */

import { getConfig, buildAuthHeaders } from '../lib/api.js';

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
      data?: { id: string; name: string; key: string; key_prefix: string; scopes: string[]; created_at: string };
      detail?: string;
      message?: string;
    }>('POST', '/api/settings/api-keys', { name, scopes });

    if (!res.ok) {
      const msg = (data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `HTTP ${res.status}`;
      console.error(`\n❌ APIキーの作成に失敗しました: ${msg}`);
      process.exit(1);
    }

    const key = data.data!;
    console.log(`\n✅ APIキーを作成しました`);
    console.log();
    console.log(`   ${key.key}`);
    console.log();
    console.log(`   名前:           ${key.name}`);
    console.log(`   スコープ:       ${key.scopes.join(', ')}`);
    console.log(`   プレフィックス: ${key.key_prefix}`);
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
      data?: { keys: { id: string; name: string; key_prefix: string; scopes: string[]; last_used_at: string | null; created_at: string }[] };
      detail?: string;
      message?: string;
    }>('GET', '/api/settings/api-keys');

    if (!res.ok) {
      const msg = (data as Record<string, unknown>).detail ?? (data as Record<string, unknown>).message ?? `HTTP ${res.status}`;
      console.error(`\n❌ APIキー一覧の取得に失敗しました: ${msg}`);
      process.exit(1);
    }

    const keys = data.data?.keys ?? [];
    if (keys.length === 0) {
      console.log('\n   APIキーはありません。');
      return;
    }

    console.log();
    for (const key of keys) {
      const date = key.created_at.slice(0, 10);
      const scopes = key.scopes.join(', ');
      console.log(`   ${key.key_prefix.padEnd(10)} ${key.name.padEnd(20)} ${scopes.padEnd(22)} ${date}`);
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
      data?: { keys: { id: string; name: string; key_prefix: string }[] };
    }>('GET', '/api/settings/api-keys');

    if (!listRes.ok) {
      console.error(`\n❌ APIキー一覧の取得に失敗しました。`);
      process.exit(1);
    }

    const keys = listData.data?.keys ?? [];
    const target = keys.find(k => k.key_prefix === prefix || k.id === prefix);
    if (!target) {
      console.error(`\n❌ プレフィックス '${prefix}' に一致するAPIキーが見つかりません。`);
      process.exit(1);
    }

    const { res } = await sessionRequest('DELETE', `/api/settings/api-keys/${target.id}`);

    if (!res.ok) {
      console.error(`\n❌ APIキーの無効化に失敗しました (${res.status})`);
      process.exit(1);
    }

    console.log(`\n✅ APIキー '${target.name}' (${target.key_prefix}) を無効化しました`);
  } catch (err) {
    console.error(`\n❌ ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
