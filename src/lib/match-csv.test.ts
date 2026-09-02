/**
 * match-csv: matchColumn 方式 CSV の差分計算
 *
 * スナップショットとのキー比較で「変更・新規行のみ送る」判定が正しく、
 * 前提が崩れるケース (ヘッダ変更・キー欠落/重複) で全行送信へフォールバック
 * (= null) することを検証する。
 */
import assert from 'node:assert';
import { test } from 'node:test';
import {
  computeMatchColumnDiff,
  parseCsvRecords,
  resolveMatchHeaderName,
} from './match-csv.js';

const HEADER = 'キー,タイトル,状況,更新';
const snap = [HEADER, 'a,Alpha,完了,2026-07-01', 'b,Beta,未着手,2026-07-01', 'c,Gamma,未着手,2026-07-01'].join('\n') + '\n';

test('computeMatchColumnDiff: 変更なしなら changedCount=0 でヘッダのみ返す', () => {
  const d = computeMatchColumnDiff(snap, snap, 'キー');
  assert.ok(d);
  assert.strictEqual(d.changedCount, 0);
  assert.strictEqual(d.unchangedCount, 3);
  assert.strictEqual(d.changedCsv, `${HEADER}\n`);
});

test('computeMatchColumnDiff: 値変更行と新規行のみ返す (削除キーは対象外)', () => {
  const current =
    [HEADER, 'a,Alpha,完了,2026-07-01', 'b,Beta,完了,2026-07-07', 'd,Delta,未着手,2026-07-07'].join('\n') + '\n';
  const d = computeMatchColumnDiff(current, snap, 'キー');
  assert.ok(d);
  assert.strictEqual(d.changedCount, 2);
  assert.strictEqual(d.unchangedCount, 1);
  assert.ok(d.changedCsv.includes('b,Beta,完了,2026-07-07'));
  assert.ok(d.changedCsv.includes('d,Delta,未着手,2026-07-07'));
  assert.ok(!d.changedCsv.includes('Alpha'));
  assert.ok(!d.changedCsv.includes('Gamma')); // c の削除はここでは扱わない
});

test('computeMatchColumnDiff: 引用符付きフィールド (カンマ・改行含む) を等価判定できる', () => {
  const header = 'キー,備考,更新';
  const s = [header, 'a,"x, y",2026-07-01'].join('\n') + '\n';
  const cSame = [header, 'a,"x, y",2026-07-01'].join('\n') + '\n';
  const cDiff = [header, 'a,"x, y, z",2026-07-01'].join('\n') + '\n';
  assert.strictEqual(computeMatchColumnDiff(cSame, s, 'キー')?.changedCount, 0);
  assert.strictEqual(computeMatchColumnDiff(cDiff, s, 'キー')?.changedCount, 1);
});

test('computeMatchColumnDiff: ヘッダ変更 (列追加等) は null で全行送信へフォールバック', () => {
  const current = ['キー,タイトル,状況,新列,更新', 'a,Alpha,完了,x,2026-07-01'].join('\n') + '\n';
  assert.strictEqual(computeMatchColumnDiff(current, snap, 'キー'), null);
});

test('computeMatchColumnDiff: match ヘッダが無い / キー空欄 / キー重複は null', () => {
  assert.strictEqual(computeMatchColumnDiff(snap, snap, '存在しない列'), null);
  const emptyKey = [HEADER, ',Alpha,完了,2026-07-01'].join('\n') + '\n';
  assert.strictEqual(computeMatchColumnDiff(emptyKey, snap, 'キー'), null);
  const dupKey = [HEADER, 'a,Alpha,完了,2026-07-01', 'a,Alpha2,完了,2026-07-01'].join('\n') + '\n';
  assert.strictEqual(computeMatchColumnDiff(dupKey, snap, 'キー'), null);
});

test('resolveMatchHeaderName: 列ID は meta.columns の id→name で解決、無ければそのまま', () => {
  const cols = [{ id: 'col123', name: 'キー' }, { name: 'タイトル' }];
  assert.strictEqual(resolveMatchHeaderName('col123', cols), 'キー');
  assert.strictEqual(resolveMatchHeaderName('キー', cols), 'キー');
  assert.strictEqual(resolveMatchHeaderName('col999', cols), 'col999');
  assert.strictEqual(resolveMatchHeaderName('キー', undefined), 'キー');
});

test('parseCsvRecords: 引用符内の改行・エスケープ・末尾改行を正しく扱う', () => {
  const csv = 'a,"line1\nline2","he said ""hi"""\nb,plain,x\n';
  const rec = parseCsvRecords(csv);
  assert.strictEqual(rec.length, 2);
  assert.deepStrictEqual(rec[0], ['a', 'line1\nline2', 'he said "hi"']);
  assert.deepStrictEqual(rec[1], ['b', 'plain', 'x']);
});
