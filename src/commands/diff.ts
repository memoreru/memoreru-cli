/**
 * memoreru diff — 変更ファイルの差分表示
 *
 * スナップショットと現在のファイルを比較し、unified diff 形式で表示する。
 * API 呼び出しなし（完全オフライン）。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { generateDiff } from '../lib/diff.js';
import { scanDirectory } from '../lib/scan.js';
import { classifyEntries, readSnapshot, type StatusEntry } from '../lib/state.js';

// =============================================================================
// 差分表示
// =============================================================================

function showDiffForEntry(
  projectRoot: string,
  entry: StatusEntry,
): void {
  const fullPath = join(projectRoot, entry.localPath);

  if (entry.status === 'new') {
    // 新規: 全行を追加として表示
    if (!existsSync(fullPath)) return;
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    console.log(`diff --git a/${entry.localPath} b/${entry.localPath}`);
    console.log(`new file`);
    console.log(`--- /dev/null`);
    console.log(`+++ b/${entry.localPath}`);
    console.log(`@@ -0,0 +1,${lines.length} @@`);
    for (const line of lines) {
      console.log(`+${line}`);
    }
    console.log();
    return;
  }

  if (entry.status === 'deleted') {
    // 削除: スナップショットの全行を削除として表示
    if (!entry.contentId) return;
    const snapshot = readSnapshot(projectRoot, entry.contentId, entry.contentType);
    if (!snapshot) {
      console.log(`  Cannot show diff: no snapshot for "${entry.title}"\n`);
      return;
    }
    const lines = snapshot.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    console.log(`diff --git a/${entry.localPath} b/${entry.localPath}`);
    console.log(`deleted file`);
    console.log(`--- a/${entry.localPath}`);
    console.log(`+++ /dev/null`);
    console.log(`@@ -1,${lines.length} +0,0 @@`);
    for (const line of lines) {
      console.log(`-${line}`);
    }
    console.log();
    return;
  }

  if (entry.status === 'modified') {
    if (!entry.contentId) return;

    const snapshot = readSnapshot(projectRoot, entry.contentId, entry.contentType);
    if (!snapshot) {
      console.log(`  No snapshot available for "${entry.title}". Run \`memoreru pull\` first.\n`);
      return;
    }

    if (!existsSync(fullPath)) {
      console.log(`  File not found: ${entry.localPath}\n`);
      return;
    }

    const current = readFileSync(fullPath, 'utf-8');

    // body が変わっていなければ meta のみの変更 → diff 表示不要
    if (entry.detail === 'meta') {
      console.log(`  ${entry.localPath}: metadata changed (body unchanged)\n`);
      return;
    }

    const diff = generateDiff(
      snapshot,
      current,
      `a/${entry.localPath}`,
      `b/${entry.localPath}`,
      entry.localPath,
    );

    if (diff) {
      console.log(diff);
      console.log();
    }
    return;
  }

  if (entry.status === 'missing') {
    if (!entry.contentId) return;
    const snapshot = readSnapshot(projectRoot, entry.contentId, entry.contentType);
    if (!snapshot) {
      console.log(`  ${entry.localPath}: file missing, no snapshot available\n`);
      return;
    }
    const lines = snapshot.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    console.log(`diff --git a/${entry.localPath} b/${entry.localPath}`);
    console.log(`deleted file (missing)`);
    console.log(`--- a/${entry.localPath}`);
    console.log(`+++ /dev/null`);
    console.log(`@@ -1,${lines.length} +0,0 @@`);
    for (const line of lines) {
      console.log(`-${line}`);
    }
    console.log();
    return;
  }

  if (entry.status === 'corrupted') {
    console.log(`  ${entry.localPath}: snapshot corrupted. Run \`memoreru pull\` to restore.\n`);
  }
}

// =============================================================================
// Main
// =============================================================================

export async function diffCommand(
  directory: string | undefined,
  options: { file?: string },
): Promise<void> {
  const projectRoot = directory || '.';

  if (!existsSync(join(projectRoot, '.memoreru'))) {
    console.log('\n  No baseline found. Run `memoreru pull` or `memoreru push` first.\n');
    return;
  }

  const entries = scanDirectory(projectRoot);
  const classified = classifyEntries(projectRoot, entries);

  // 差分があるエントリのみ（folder はボディがないので除外）
  let targets = classified.filter(e =>
    e.contentType !== 'folder' &&
    (e.status === 'modified' || e.status === 'new' || e.status === 'deleted' || e.status === 'corrupted' || e.status === 'missing'),
  );

  // --file オプションでフィルタ
  if (options.file) {
    const fileFilter = options.file;
    targets = targets.filter(e =>
      e.localPath === fileFilter || e.localPath.endsWith(`/${fileFilter}`),
    );
    if (targets.length === 0) {
      console.log(`\n  No changes found for "${fileFilter}"\n`);
      return;
    }
  }

  if (targets.length === 0) {
    console.log('\n  No changes\n');
    return;
  }

  console.log();
  for (const entry of targets) {
    showDiffForEntry(projectRoot, entry);
  }
}
