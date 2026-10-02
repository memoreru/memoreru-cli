import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configure } from '../lib/api.js';
import { exchangeLoginCode } from './login.js';
import { keysCreateCommand, keysListCommand, keysRevokeCommand, normalizeApiKey } from './keys.js';

test('API key normalization maps server camelCase fields explicitly', () => {
  assert.deepEqual(normalizeApiKey({
    id: 'k1', name: 'CLI', key: 'mock-key', keyPrefix: 'prefix', scopes: ['api:read'],
    lastUsedAt: '2026-02-01', createdAt: '2026-01-01',
  }), {
    id: 'k1', name: 'CLI', key: 'mock-key', keyPrefix: 'prefix', scopes: ['api:read'],
    lastUsedAt: '2026-02-01', createdAt: '2026-01-01',
  });
});

test('login exchange sends code and normalizes camelCase response through HTTP', async () => {
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({ url: String(input), method: init?.method, body: String(init?.body) });
    return Response.json({ user: { id: 'u1', name: null, email: 'user@example.test' }, tenantId: 't1' });
  }) as typeof fetch;
  try {
    const result = await exchangeLoginCode('https://example.test', 'authorization-code');
    assert.deepEqual(result.data, { user: { id: 'u1', name: 'user@example.test', email: 'user@example.test' }, tenantId: 't1' });
    assert.equal(result.data?.tenantId, 't1', 'login exchange consumes tenantId');
  } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(calls, [{
    url: 'https://example.test/api/external/v1/cli-auth/exchange', method: 'POST', body: '{"code":"authorization-code"}',
  }]);
});

test('API key commands use declared HTTP contracts and honor the API key response contract', async () => {
  const calls: Array<{ url: URL; method?: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;
  const logs: string[] = [];
  configure({ baseUrl: 'https://example.test' });
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method, body });
    if (init?.method === 'POST') {
      return Response.json({ status: 'success', data: { id: 'k1', name: 'CLI', key: 'test-key-value', keyPrefix: 'prefix', scopes: ['api:read'], createdAt: '2026-01-01' } });
    }
    if (init?.method === 'DELETE') return Response.json({});
    return Response.json({ status: 'success', data: { keys: [{ id: 'k1', name: 'CLI', keyPrefix: 'prefix', scopes: ['api:read'], lastUsedAt: '2026-02-01', createdAt: '2026-01-01' }] } });
  }) as typeof fetch;
  console.log = (...args: unknown[]) => logs.push(args.join(' '));
  try {
    await keysCreateCommand({ name: 'CLI', readOnly: true });
    await keysListCommand({});
    await keysRevokeCommand('prefix', {});
  } finally { globalThis.fetch = originalFetch; console.log = originalLog; }
  assert.deepEqual(calls.map(({ url, method, body }) => ({ path: url.pathname, method, query: [...url.searchParams.keys()], body })), [
    { path: '/api/external/v1/api-keys', method: 'POST', query: [], body: { name: 'CLI', scopes: ['api:read'] } },
    { path: '/api/external/v1/api-keys', method: 'GET', query: [], body: undefined },
    { path: '/api/external/v1/api-keys', method: 'GET', query: [], body: undefined },
    { path: '/api/external/v1/api-keys/k1', method: 'DELETE', query: [], body: undefined },
  ]);
  assert.ok(logs.some(line => line.includes('プレフィックス: prefix')));
  assert.ok(logs.some(line => line.includes('test-key-value')), 'create consumes the camelCase key response field');
  assert.ok(logs.some(line => line.includes('prefix') && line.includes('CLI') && line.includes('2026-01-01')));
  assert.ok(logs.some(line => line.includes("'CLI' (prefix)")));
});
