/**
 * scripts-sync の純粋ヘルパーのテスト（node:test・追加依存なし）
 * - resolveScriptFilePath: パストラバーサル防止（security）
 * - planScriptSync: file_name / script_id 照合の作成・更新振り分け
 * - scriptTitleOf: タイトル既定値
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  planScriptSync,
  resolveScriptFilePath,
  type ScriptManifestEntry,
  scriptTitleOf,
  triggerTypesOf,
} from './scripts-sync.js';

const rec = (over: Partial<import('./api.js').ScriptRecord> & { script_id: string }) => ({
  content_id: 'c1',
  title: 'X',
  script_type: 'script' as const,
  code: '',
  file_name: null,
  is_disabled: false,
  execution_order: null,
  version: 1,
  ...over,
});

const DIR = '/work/project';

test('resolveScriptFilePath: ディレクトリ内の相対パスを解決する', () => {
  assert.equal(resolveScriptFilePath(DIR, 'scripts/on-create.js'), '/work/project/scripts/on-create.js');
  assert.equal(resolveScriptFilePath(DIR, 'styles/main.css'), '/work/project/styles/main.css');
});

test('resolveScriptFilePath: ディレクトリ外を指すパスは拒否する', () => {
  assert.throws(() => resolveScriptFilePath(DIR, '../secrets.js'), /ディレクトリ外/);
  assert.throws(() => resolveScriptFilePath(DIR, '../../etc/passwd'), /ディレクトリ外/);
  assert.throws(() => resolveScriptFilePath(DIR, '/etc/passwd'), /ディレクトリ外/);
});

test('resolveScriptFilePath: 自ディレクトリそのものは拒否する', () => {
  assert.throws(() => resolveScriptFilePath(DIR, '.'), /ディレクトリ外/);
});

test('planScriptSync: file_name 一致は更新に振り分ける', () => {
  const entries: ScriptManifestEntry[] = [{ type: 'script', file: 'scripts/a.js' }];
  const existing = [
    {
      script_id: 's1',
      content_id: 'c1',
      title: 'A',
      script_type: 'script' as const,
      code: '',
      file_name: 'scripts/a.js',
      is_disabled: false,
      execution_order: null,
      version: 3,
    },
  ];
  const { toCreate, toUpdate } = planScriptSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toUpdate[0].existing.script_id, 's1');
});

test('planScriptSync: script_id 一致は file_name が違っても更新に振り分ける', () => {
  const entries: ScriptManifestEntry[] = [
    { type: 'script', file: 'scripts/renamed.js', script_id: 's1' },
  ];
  const existing = [
    {
      script_id: 's1',
      content_id: 'c1',
      title: 'A',
      script_type: 'script' as const,
      code: '',
      file_name: 'scripts/old.js',
      is_disabled: false,
      execution_order: null,
      version: 1,
    },
  ];
  const { toCreate, toUpdate } = planScriptSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
});

test('planScriptSync: 未一致は作成に振り分ける', () => {
  const entries: ScriptManifestEntry[] = [{ type: 'style', file: 'styles/new.css' }];
  const { toCreate, toUpdate } = planScriptSync(entries, []);
  assert.equal(toCreate.length, 1);
  assert.equal(toUpdate.length, 0);
});

test('planScriptSync: manifest に無い既存は toDelete（prune 候補）に入る', () => {
  const entries: ScriptManifestEntry[] = [{ type: 'script', file: 'scripts/keep.js' }];
  const existing = [
    rec({ script_id: 'keep', file_name: 'scripts/keep.js' }),
    rec({ script_id: 'orphan', file_name: 'scripts/removed.js' }),
  ];
  const { toCreate, toUpdate, toDelete } = planScriptSync(entries, existing);
  assert.equal(toCreate.length, 0);
  assert.equal(toUpdate.length, 1);
  assert.equal(toDelete.length, 1);
  assert.equal(toDelete[0].script_id, 'orphan');
});

test('triggerTypesOf: オブジェクト配列を trigger_type 文字列へ正規化', () => {
  assert.deepEqual(
    triggerTypesOf([{ trigger_type: 'after_create' }, { trigger_type: 'after_update' }]),
    ['after_create', 'after_update'],
  );
  assert.deepEqual(triggerTypesOf(['on_display']), ['on_display']);
  assert.equal(triggerTypesOf(undefined), undefined);
});

test('scriptTitleOf: title 優先、無ければ拡張子抜きのベース名', () => {
  assert.equal(scriptTitleOf({ type: 'script', file: 'scripts/a.js', title: '行の色付け' }), '行の色付け');
  assert.equal(scriptTitleOf({ type: 'script', file: 'scripts/on-create.js' }), 'on-create');
  assert.equal(scriptTitleOf({ type: 'style', file: 'styles/main.css' }), 'main');
});
