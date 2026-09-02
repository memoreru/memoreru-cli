import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pushCommand } from '../commands/push.js';
import { configure } from './api.js';

test('差分 table push は未変更行を upsert API payload に含めない', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoreru-cli-push-'));
  const originalFetch = globalThis.fetch;
  const originalTenant = process.env.MEMORERU_TENANT;
  const upsertPayloads: Record<string, unknown>[] = [];

  try {
    delete process.env.MEMORERU_TENANT;
    writeFileSync(
      join(dir, '.memoreru.json'),
      JSON.stringify({
        'data.csv': {
          contentId: 'table-1',
          contentType: 'table',
          title: 'Table',
        },
      }),
    );
    writeFileSync(
      join(dir, 'data.csv'),
      ['row_id,version,name', 'r1,1,updated', 'r2,1,unchanged'].join('\n'),
    );
    mkdirSync(join(dir, '.memoreru', 'snapshots'), { recursive: true });
    writeFileSync(
      join(dir, '.memoreru', 'snapshots', 'table-1.csv'),
      ['row_id,version,name', 'r1,1,original', 'r2,1,unchanged'].join('\n'),
    );

    configure({ baseUrl: 'https://example.test', apiKey: 'test-key' });
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/external/sync/tenant')) {
        return new Response(JSON.stringify({ slug: 'test', isDefault: true }));
      }
      if (url.endsWith('/api/external/sync/upsert')) {
        upsertPayloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(JSON.stringify({
          contentId: 'table-1',
          created: false,
          uploadedCount: 0,
          skippedCount: 0,
          rowIds: ['r1'],
          rowVersions: [2],
        }));
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    await pushCommand(dir, {});

    assert.strictEqual(upsertPayloads.length, 1);
    assert.deepStrictEqual(Object.keys(upsertPayloads[0]).sort(), [
      'contentId',
      'contentType',
      'csvData',
      'language',
      'publishStatus',
      'rowIds',
      'rowVersions',
      'scope',
      'title',
    ]);
    assert.ok(!('_unchangedRows' in upsertPayloads[0]));
  } finally {
    globalThis.fetch = originalFetch;
    if (originalTenant === undefined) delete process.env.MEMORERU_TENANT;
    else process.env.MEMORERU_TENANT = originalTenant;
    rmSync(dir, { recursive: true, force: true });
  }
});
