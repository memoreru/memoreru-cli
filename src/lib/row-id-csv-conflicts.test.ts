/**
 * excludeConflictRowsFromCsv: 競合で拒否された行をスナップショットから除く
 *
 * push の差分計算はローカルスナップショット基準で行う (computeRowDiff)。
 * スナップショットを「プッシュ結果に関わらずローカルの最終状態」で保存すると、
 * 楽観ロック競合でサーバーに拒否された行まで「送信済み」として記録され、
 * 次回以降 computeRowDiff が「変更なし」と判定して **永久に送られなくなる**。
 * しかも push は最後に成功表示で終わるため、乖離がサイレントに残り続ける。
 *
 * 実害: dev だけ古い値のまま残り、2 回目の deploy は "No row changes detected" で
 * 1 行も送らなかった。
 */
import assert from 'node:assert';
import { test } from 'node:test';
import { computeRowDiff, excludeConflictRowsFromCsv } from './row-id-csv.js';

const CSV = ['row_id,version,name', 'r1,1,alpha', 'r2,2,bravo', 'r3,1,charlie'].join('\n');

test('競合した行だけを取り除く', () => {
  const out = excludeConflictRowsFromCsv(CSV, [{ row_id: 'r2' }]);
  assert.strictEqual(out, ['row_id,version,name', 'r1,1,alpha', 'r3,1,charlie'].join('\n'));
});

test('競合が無ければ入力をそのまま返す', () => {
  assert.strictEqual(excludeConflictRowsFromCsv(CSV, []), CSV);
  assert.strictEqual(excludeConflictRowsFromCsv(CSV, undefined), CSV);
});

test('未知の row_id は無視する（行を落とさない）', () => {
  assert.strictEqual(excludeConflictRowsFromCsv(CSV, [{ row_id: 'unknown' }]), CSV);
});

test('ヘッダーのみの CSV でも壊れない', () => {
  const header = 'row_id,version,name';
  assert.strictEqual(excludeConflictRowsFromCsv(header, [{ row_id: 'r1' }]), header);
});

test('除外した行は次回の差分計算で「変更あり」として再送される', () => {
  // 競合した r2 を除いたものをスナップショットとして保存した想定
  const snapshot = excludeConflictRowsFromCsv(CSV, [{ row_id: 'r2' }]);
  const diff = computeRowDiff(CSV, snapshot);

  assert.deepStrictEqual(diff.changedRowIds, ['r2']);
  assert.strictEqual(diff.unchangedRows.length, 2);
});

test('除外しないと次回の差分計算で「変更なし」になり永久に送られない', () => {
  // 修正前の挙動（ローカル最終状態をそのままスナップショットに保存）
  const diff = computeRowDiff(CSV, CSV);

  assert.deepStrictEqual(diff.changedRowIds, []);
});
