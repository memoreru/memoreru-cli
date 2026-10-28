import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configure, upsertContent } from './api.js';

test('upsert projects column settings to supported keys and warns once without values', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const calls: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  const manifestSettings = {
    Key: {
      required: true,
      description: 'Stable key',
      options: [
        {
          key: 'open',
          value: 'Open',
          color: 'green',
          description: 'Available',
          internalOptionFlag: 'do not include this value',
        },
      ],
      uniqueValue: true,
    },
  };
  const originalManifestSettings = structuredClone(manifestSettings);
  configure({ baseUrl: 'https://example.test' });
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ data: { contentId: 'table-1', created: false } });
  }) as typeof fetch;
  console.error = (...values: unknown[]) => warnings.push(values.map(String).join(' '));

  try {
    await upsertContent({
      contentType: 'table',
      title: 'Table',
      csvData: ['Key', ...Array.from({ length: 501 }, (_, index) => `row-${index}`)].join('\n'),
      columnSettings: manifestSettings,
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  assert.equal(calls.length, 2);
  assert.deepEqual(manifestSettings, originalManifestSettings);
  assert.deepEqual(calls[0].columnSettings, {
    Key: {
      required: true,
      description: 'Stable key',
      options: [{ key: 'open', value: 'Open', color: 'green', description: 'Available' }],
    },
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /uniqueValue/);
  assert.match(warnings[0], /internalOptionFlag/);
  assert.doesNotMatch(warnings[0], /do not include this value/);
  assert.doesNotMatch(warnings[0], /Stable key|Available/);
});

test('upsert does not warn when every column setting key is supported', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const warnings: string[] = [];
  configure({ baseUrl: 'https://example.test' });
  globalThis.fetch = (async () =>
    Response.json({ data: { contentId: 'table-1', created: false } })) as typeof fetch;
  console.error = (...values: unknown[]) => warnings.push(values.map(String).join(' '));

  try {
    await upsertContent({
      contentType: 'table',
      title: 'Table',
      csvData: 'Key\nvalue',
      columnSettings: {
        Key: {
          required: true,
          description: 'Stable key',
          options: [{ key: 'open', value: 'Open' }],
        },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }

  assert.deepEqual(warnings, []);
});
