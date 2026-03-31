/**
 * memoreru status — ローカル変更状態の一覧表示
 *
 * pull/push 時に保存したスナップショットと現在のファイルを比較し、
 * 変更・新規・削除を表示する。API 呼び出しなし（完全オフライン）。
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { scanDirectory } from '../lib/scan.js';
import { classifyEntries, type FileStatus, type StatusEntry } from '../lib/state.js';

// =============================================================================
// 表示ヘルパー
// =============================================================================

const STATUS_ICONS: Record<FileStatus, string> = {
  modified: 'M',
  new: '+',
  deleted: 'D',
  unchanged: '=',
  corrupted: '!',
  missing: '?',
};

function formatEntry(entry: StatusEntry): string {
  const icon = STATUS_ICONS[entry.status];
  const detail = entry.detail ? ` [${entry.detail}]` : '';
  return `    ${icon}  ${entry.localPath} (${entry.contentType}) "${entry.title}"${detail}`;
}

// =============================================================================
// Main
// =============================================================================

export async function statusCommand(
  directory: string | undefined,
  _options: Record<string, unknown>,
): Promise<void> {
  const projectRoot = directory || '.';

  // .memoreru/ が存在しない場合の案内
  if (!existsSync(join(projectRoot, '.memoreru'))) {
    console.log('\n  memoreru status\n');
    console.log('  No baseline found. Run `memoreru pull` or `memoreru push` first');
    console.log('  to create a baseline for change detection.\n');
    return;
  }

  const entries = scanDirectory(projectRoot);
  const classified = classifyEntries(projectRoot, entries);

  // ステータス別にグループ化
  const modified = classified.filter(e => e.status === 'modified');
  const newEntries = classified.filter(e => e.status === 'new');
  const deleted = classified.filter(e => e.status === 'deleted');
  const corrupted = classified.filter(e => e.status === 'corrupted');
  const missing = classified.filter(e => e.status === 'missing');

  console.log('\n  memoreru status\n');

  if (corrupted.length > 0) {
    console.log('  Corrupted snapshots (run `memoreru pull` to restore):');
    for (const entry of corrupted) console.log(formatEntry(entry));
    console.log();
  }

  if (modified.length > 0) {
    console.log('  Modified:');
    for (const entry of modified) console.log(formatEntry(entry));
    console.log();
  }

  if (newEntries.length > 0) {
    console.log('  New (not yet pushed):');
    for (const entry of newEntries) console.log(formatEntry(entry));
    console.log();
  }

  if (deleted.length > 0) {
    console.log('  Deleted (removed locally):');
    for (const entry of deleted) console.log(formatEntry(entry));
    console.log();
  }

  if (missing.length > 0) {
    console.log('  Missing (file not found):');
    for (const entry of missing) console.log(formatEntry(entry));
    console.log();
  }

  const total = classified.length;
  const changedCount = modified.length + newEntries.length + deleted.length + corrupted.length + missing.length;

  if (changedCount === 0) {
    console.log('  No changes\n');
  } else {
    const parts = [
      modified.length > 0 ? `${modified.length} modified` : '',
      newEntries.length > 0 ? `${newEntries.length} new` : '',
      deleted.length > 0 ? `${deleted.length} deleted` : '',
      corrupted.length > 0 ? `${corrupted.length} corrupted` : '',
      missing.length > 0 ? `${missing.length} missing` : '',
    ].filter(Boolean).join(', ');
    console.log(`  ${total} content(s): ${parts}\n`);
  }
}
