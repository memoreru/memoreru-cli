/**
 * extensions-sync の純粋ヘルパーのテスト（node:test・追加依存なし）
 * - resolveExtensionFilePath: パストラバーサル防止（security）
 * - planExtensionSync: file_name / extension_id 照合の作成・更新・削除振り分け
 * - extensionTitleOf: タイトル既定値 / triggerTypesOf: トリガー正規化
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type ExtensionManifestEntry,
  extensionTitleOf,
  planExtensionSync,
  resolveExtensionFilePath,
  triggerTypesOf,
} from './extensions-sync.js';

const rec = (over: Partial<import('./api.js').ExtensionRecord> & { extensionId: string }) => ({
  contentId: 'c1',
  title: 'X',
  type: 'script' as const,
  code: '',
  fileName: null,
  isDisabled: false,
  executionOrder: null,
  version: 1,
  ...over,
});

const DIR = '/work/project';

test('resolveExtensionFilePath: ディレクトリ内の相対パスを解決する', () => {
  assert.equal(resolveExtensionFilePath(DIR, 'scripts/on-create.js'), '/work/project/scripts/on-create.js');
  assert.equal(resolveExtensionFilePath(DIR, 'styles/main.css'), '/work/project/styles/main.css');
});

test('resolveExtensionFilePath: ディレクトリ外を指すパスは拒否する', () => {
  assert.throws(() => resolveExtensionFilePath(DIR, '../secrets.js'), /ディレクトリ外/);
  assert.throws(() => resolveExtensionFilePath(DIR, '../../etc/passwd'), /ディレクトリ外/);
  assert.throws(() => resolveExtensionFilePath(DIR, '/etc/passwd'), /ディレクトリ外/);
});

test('resolveExtensionFilePath: 自ディレクトリそのものは拒否する', () => {
  assert.throws(() => resolveExtensionFilePath(DIR, '.'), /ディレクトリ外/);
});

test('planExtensionSync: file_name 一致は更新に振り分ける', () => {
  const entries: ExtensionManifestEntry[] = [{ type: 'script', file: 'scripts/a.js' }];
  const existing = [rec({ extensionId: 's1', fileName: 'scripts/a.js', version: 3 })];
  const { toCreate, toUpdate } = planExtensionSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].existing.extensionId, 's1');
});

test('planExtensionSync: extension_id 一致は file_name が違っても更新に振り分ける', () => {
  const entries: ExtensionManifestEntry[] = [
    { type: 'script', file: 'scripts/renamed.js', extension_id: 's1' },
  ];
  const existing = [rec({ extensionId: 's1', fileName: 'scripts/old.js' })];
  const { toCreate, toUpdate } = planExtensionSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
});

test('planExtensionSync: 未一致は作成に振り分ける', () => {
  const entries: ExtensionManifestEntry[] = [{ type: 'style', file: 'styles/new.css' }];
  const { toCreate, toUpdate } = planExtensionSync(entries, []);
  assert.equal(toCreate.length, 1);
  assert.equal(toUpdate.length, 0);
});

test('planExtensionSync: manifest に無い既存は toDelete（prune 候補）に入る', () => {
  const entries: ExtensionManifestEntry[] = [{ type: 'script', file: 'scripts/keep.js' }];
  const existing = [
    rec({ extensionId: 'keep', fileName: 'scripts/keep.js' }),
    rec({ extensionId: 'orphan', fileName: 'scripts/removed.js' }),
  ];
  const { toCreate, toUpdate, toDelete } = planExtensionSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toDelete.length, 1);
  assert.equal(toDelete[0].extensionId, 'orphan');
});

test('triggerTypesOf: オブジェクト配列を trigger_type 文字列へ正規化', () => {
  assert.deepEqual(
    triggerTypesOf([{ trigger_type: 'after_create' }, { trigger_type: 'after_update' }]),
    ['after_create', 'after_update'],
  );
  assert.deepEqual(triggerTypesOf(['on_display']), ['on_display']);
  assert.equal(triggerTypesOf(undefined), undefined);
});

test('extensionTitleOf: title 優先、無ければ拡張子抜きのベース名', () => {
  assert.equal(extensionTitleOf({ type: 'script', file: 'scripts/a.js', title: '行の色付け' }), '行の色付け');
  assert.equal(extensionTitleOf({ type: 'script', file: 'scripts/on-create.js' }), 'on-create');
  assert.equal(extensionTitleOf({ type: 'style', file: 'styles/main.css' }), 'main');
});
