import assert from 'node:assert/strict';
import { test } from 'node:test';
import contract from './fixtures/api-contract.openapi.json' with { type: 'json' };
import { exchangeLoginCode } from '../commands/login.js';
import { keysCreateCommand, keysListCommand, keysRevokeCommand } from '../commands/keys.js';
import {
  configure,
  createExtension,
  deleteExtension,
  deleteTableRows,
  downloadImage,
  fetchTableRowIds,
  getTenantInfo,
  listChildren,
  listExtensions,
  listRootContents,
  pullContent,
  pullTableData,
  pickUpsertRequestFields,
  pushContent,
  updateExtension,
  uploadImage,
  UPSERT_REQUEST_KEYS,
  upsertContent,
} from './api.js';

test('public-api-contract-senders-use-declared-request-keys', async () => {
  const calls: Array<{ url: URL; method: string; body?: Record<string, unknown> }> = [];
  const originalFetch = globalThis.fetch;
  configure({ baseUrl: 'https://example.test' });
  const originalLog = console.log;
  console.log = () => {};
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : undefined;
    calls.push({ url, method: init?.method ?? 'GET', body });
    if (url.pathname.startsWith('/api/images/')) return new Response(new Uint8Array([1]));
    if (url.pathname.endsWith('/cli-auth/exchange')) return Response.json({ user: { id: 'u1', name: 'User', email: 'user@example.test' }, tenantId: 't1' });
    if (url.pathname.endsWith('/api-keys') && init?.method === 'POST') return Response.json({ status: 'success', data: { id: 'k1', name: 'CLI', key: 'mock-key', keyPrefix: 'prefix', scopes: ['api:read'], createdAt: '2026-01-01' } });
    if (url.pathname.endsWith('/api-keys') && init?.method === 'GET') return Response.json({ status: 'success', data: { keys: [{ id: 'k1', name: 'CLI', keyPrefix: 'prefix', scopes: ['api:read'], lastUsedAt: null, createdAt: '2026-01-01' }] } });
    if (url.pathname.includes('/api-keys/')) return Response.json({ status: 'success' });
    if (url.pathname.endsWith('/tables/table/rows') && init?.method === 'GET') {
      return Response.json({ data: { rows: [] }, pagination: { limit: 500, hasMore: false, nextCursor: null } });
    }
    return Response.json({ data: { contentId: 'content', created: false } });
  }) as typeof fetch;

  try {
    await pushContent('content', 'body', []);
    await uploadImage('content', { localPath: './image.png', data: 'data', mimeType: 'image/png' });
    await pullContent('content', 'slide');
    await listExtensions('content', 'script');
    await createExtension('content', { title: 'Extension', type: 'script', code: 'code' });
    await updateExtension('content', 'extension', { version: 1, isDisabled: true });
    await deleteExtension('content', 'extension');
    await upsertContent({
      contentType: 'table',
      title: 'Table',
      csvData: 'Name\nValue',
      columnSettings: { Name: { required: true, options: [{ key: 'a', value: 'A' }] } },
      settings: { display: { sort: [{ field: 'Name' }] } },
      undeclaredFlag: true,
    });
    await deleteTableRows('table', ['row']);
    await pullTableData('table');
    await fetchTableRowIds('table');
    await listChildren('folder id');
    await listRootContents(true);
    await getTenantInfo();
    await downloadImage('/api/images/image.png');
    await exchangeLoginCode('https://example.test', 'authorization-code');
    await keysCreateCommand({ name: 'CLI', readOnly: true });
    await keysListCommand({});
    await keysRevokeCommand('prefix', {});
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
  }

  const bodyKeys = (path: string, method: string) => {
    const call = calls.find(item => item.url.pathname === path && item.method === method);
    assert.ok(call, `missing ${method} ${path}`);
    return Object.keys(call.body ?? {}).sort();
  };
  assert.deepEqual(bodyKeys('/api/external/v1/sync/push/content', 'POST'), ['body', 'contentType', 'images']);
  assert.deepEqual(bodyKeys('/api/external/v1/sync/upload-image/content', 'POST'), ['data', 'localPath', 'mimeType']);
  assert.deepEqual(bodyKeys('/api/v1/contents/content/extensions', 'POST'), ['code', 'title', 'type']);
  assert.deepEqual(bodyKeys('/api/v1/contents/content/extensions/extension', 'PATCH'), ['isDisabled', 'version']);
  assert.deepEqual(bodyKeys('/api/external/v1/sync/upsert', 'POST'), ['columnSettings', 'contentType', 'csvData', 'settings', 'title']);
  assert.deepEqual(bodyKeys('/api/v1/contents/tables/table/rows', 'DELETE'), ['rowIds']);
  assert.equal(calls.filter(item => item.url.pathname === '/api/v1/contents/tables/table/columns').length, 1);
  assert.equal(calls.filter(item => item.url.pathname === '/api/v1/contents/tables/table/rows' && item.method === 'GET').length, 2);
  assert.equal(calls.some(item => item.url.pathname === '/api/v1/contents/content/extensions/extension' && item.method === 'DELETE'), true);
  assert.equal(calls.some(item => item.url.pathname === '/api/external/v1/sync/tenant' && item.method === 'GET'), true);
  assert.equal(calls.some(item => item.url.pathname === '/api/images/image.png' && item.method === 'GET'), true);

  const pull = calls.find(item => item.url.pathname === '/api/external/v1/sync/pull/content');
  assert.deepEqual([...pull!.url.searchParams.keys()], ['contentType']);
  const extensionList = calls.find(item => item.url.pathname === '/api/v1/contents/content/extensions');
  assert.deepEqual([...extensionList!.url.searchParams.keys()], ['type']);
  const children = calls.find(item => item.url.pathname === '/api/v1/contents');
  assert.deepEqual([...children!.url.searchParams.keys()], ['parentContentId', 'limit']);
  const root = calls.filter(item => item.url.pathname === '/api/v1/contents').at(-1);
  assert.deepEqual([...root!.url.searchParams.keys()], ['scope', 'limit', 'createdByMe']);
  const rows = calls.find(item => item.url.pathname === '/api/v1/contents/tables/table/rows' && item.method === 'GET');
  assert.deepEqual([...rows!.url.searchParams.keys()], ['limit']);
  assert.equal(rows!.url.searchParams.has('page'), false);
  const upsertBody = calls.find(item => item.url.pathname === '/api/external/v1/sync/upsert')!.body!;
  assert.deepEqual(upsertBody.settings, { display: { sort: [{ field: 'Name' }] } });
  assert.deepEqual(upsertBody.columnSettings, { Name: { required: true, options: [{ key: 'a', value: 'A' }] } });
  const resolveSchema = (schema: any): any => {
    if (schema?.$ref) {
      const name = schema.$ref.split('/').at(-1);
      return resolveSchema((contract.components.schemas as Record<string, unknown>)[name!]);
    }
    return schema;
  };
  const operationFor = (call: typeof calls[number]) => {
    for (const [path, pathItem] of Object.entries(contract.paths)) {
      const pattern = path.split(/(\{[^}]+\})/).map(part => part.startsWith('{') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('');
      const matcher = new RegExp(`^${pattern}$`);
      if (!matcher.test(call.url.pathname)) continue;
      const operation = (pathItem as Record<string, any>)[call.method.toLowerCase()];
      if (operation) return operation;
    }
    return undefined;
  };
  const apiCalls = calls.filter(call => call.url.pathname !== '/api/images/image.png');
  assert.equal(apiCalls.length, 20, 'expected every JSON API sender including direct command senders');
  const assertMatchesContract = (call: typeof calls[number]) => {
    const operation = operationFor(call);
    assert.ok(operation, `no OpenAPI operation for ${call.method} ${call.url.pathname}`);
    const declaredQuery = (operation.parameters ?? []).filter((parameter: any) => parameter.in === 'query').map((parameter: any) => parameter.name);
    const queryKeys = [...new Set(call.url.searchParams.keys())];
    assert.ok(queryKeys.every(key => declaredQuery.includes(key)), `${call.method} ${call.url.pathname} sent undeclared query key: ${queryKeys.filter(key => !declaredQuery.includes(key)).join(', ')}`);
    const requestSchema = resolveSchema(operation.requestBody?.content?.['application/json']?.schema);
    const declaredBody = Object.keys(requestSchema?.properties ?? {});
    const sentBodyKeys = Object.keys(call.body ?? {});
    assert.ok(sentBodyKeys.every(key => declaredBody.includes(key)), `${call.method} ${call.url.pathname} sent undeclared body key: ${sentBodyKeys.filter(key => !declaredBody.includes(key)).join(', ')}`);
  };
  for (const call of apiCalls) assertMatchesContract(call);

  const upsertCall = apiCalls.find(call => call.url.pathname === '/api/external/v1/sync/upsert');
  assert.ok(upsertCall?.body, 'expected captured upsert request body');
  assert.throws(() => assertMatchesContract({
    ...upsertCall,
    body: { ...upsertCall.body, undeclaredProbe: true },
  }), /sent undeclared body key: undeclaredProbe/);

});

test('table row readers follow cursors through the terminal null cursor without duplication or loss', async () => {
  const calls: URL[] = [];
  const originalFetch = globalThis.fetch;
  const firstPageRows = Array.from({ length: 500 }, (_, index) => ({
    rowId: `r${index + 1}`,
    'name-id': `value-${index + 1}`,
  }));
  const secondPageRows = [
    { rowId: 'r501', 'name-id': 'value-501' },
    { rowId: 'r502', 'name-id': 'value-502' },
  ];
  const expectedIds = Array.from({ length: 502 }, (_, index) => `r${index + 1}`);
  const expectedValues = Array.from({ length: 502 }, (_, index) => `value-${index + 1}`);
  configure({ baseUrl: 'https://example.test' });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.pathname.endsWith('/columns')) {
      return Response.json({ data: { columns: [{ columnId: 'name-id', displayName: 'Name', dataType: 'text' }] } });
    }
    const cursor = url.searchParams.get('cursor');
    if (cursor === null) {
      return Response.json({ data: { rows: firstPageRows }, pagination: { limit: 500, hasMore: true, nextCursor: 'cursor-2' } });
    }
    assert.equal(cursor, 'cursor-2');
    return Response.json({ data: { rows: secondPageRows }, pagination: { limit: 500, hasMore: false, nextCursor: null } });
  }) as typeof fetch;

  try {
    const table = await pullTableData('table');
    assert.deepEqual(table.rows.map(row => row.row_id), expectedIds);
    assert.deepEqual(table.rows.map(row => row.Name), expectedValues);
    assert.equal(new Set(table.rows.map(row => row.row_id)).size, 502);
    const pullRequests = calls.filter(url => url.pathname.endsWith('/rows'));
    assert.equal(pullRequests.length, 2);
    assert.deepEqual(pullRequests.map(url => url.searchParams.get('cursor')), [null, 'cursor-2']);
    for (const url of pullRequests) {
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.has('page'), false);
    }
    calls.length = 0;

    const ids = await fetchTableRowIds('table');
    assert.deepEqual(ids, expectedIds);
    assert.equal(new Set(ids).size, 502);
    const idRequests = calls.filter(url => url.pathname.endsWith('/rows'));
    assert.equal(idRequests.length, 2);
    assert.deepEqual(idRequests.map(url => url.searchParams.get('cursor')), [null, 'cursor-2']);
    for (const url of idRequests) {
      assert.equal(url.searchParams.get('limit'), '500');
      assert.equal(url.searchParams.has('page'), false);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('upsert sender key contract matches declared schema keys and filters unknown manifest fields', () => {
  const expectedKeys = [
    'contentId', 'contentType', 'title', 'scope', 'body', 'images', 'csvData', 'columnIds',
    'columnTypes', 'columnSettings', 'deleteColumnIds', 'rowIds', 'rowVersions', 'matchColumn',
    'settings', 'description', 'descriptionExpanded', 'category', 'label', 'tags', 'slug',
    'thumbnail', 'icon', 'datetime', 'location', 'persons', 'sources', 'language', 'systemType',
    'customOrder', 'teamId', 'parentContentId', 'templateGroupTenantId', 'templateGroupId',
    'publishStatus', 'scheduledAt', 'expiresAt', 'isSuspended', 'isArchived', 'discovery',
    'accessLevel', 'canEmbed', 'canAiCrawl', 'hasPassword', 'isPinned', 'isLocked', 'autoSummary',
    'autoTranslate',
  ].sort();
  assert.deepEqual([...UPSERT_REQUEST_KEYS].sort(), expectedKeys);

  const settings = { view: { columns: ['a'] } };
  const columnSettings = { Status: { options: [{ key: 'open', value: 'Open' }] } };
  assert.deepEqual(pickUpsertRequestFields({ title: 'Page', settings, columnSettings, undeclaredFlag: true }),
    { title: 'Page', settings, columnSettings });
});
