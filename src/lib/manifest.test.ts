import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readManifest, readMeta, updateManifestEntry, writeMeta } from './manifest.js';

test('camelCase manifest is read and updated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoreru-cli-manifest-'));
  try {
    writeFileSync(join(dir, '.memoreru.json'), JSON.stringify({
      'page.md': { contentType: 'page', title: 'Page' },
    }));
    assert.deepEqual(readManifest(dir), {
      'page.md': { contentType: 'page', title: 'Page' },
    });
    updateManifestEntry(dir, 'page.md', { contentId: 'page-1' });
    assert.deepEqual(readManifest(dir)?.['page.md'], {
      contentType: 'page', title: 'Page', contentId: 'page-1',
    });

    writeMeta(dir, { contentId: 'folder-1', contentType: 'folder', title: 'Folder' });
    assert.deepEqual(readMeta(dir), {
      contentId: 'folder-1', contentType: 'folder', title: 'Folder',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy snake_case manifests warn and are not read', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoreru-cli-manifest-'));
  const originalWarn = console.warn;
  const warnings: string[] = [];
  try {
    writeFileSync(join(dir, '.memoreru.json'), JSON.stringify({
      'page.md': { content_type: 'page', title: 'Legacy manifest' },
    }));
    console.warn = (message: string) => warnings.push(message);
    assert.equal(readManifest(dir), null);

    writeFileSync(join(dir, '.memoreru.json'), JSON.stringify({ content_type: 'page', title: 'Legacy meta' }));
    assert.equal(readMeta(dir), null);
    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /content_type to contentType/);
  } finally {
    console.warn = originalWarn;
    rmSync(dir, { recursive: true, force: true });
  }
});
