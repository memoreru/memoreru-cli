/**
 * files: markdown 読み込みの本文整形
 *
 * push する本文から先頭の YAML frontmatter が除去され、
 * CRLF が LF に正規化されることを検証する。
 */
import assert from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readMarkdown, stripFrontmatter } from './files.js';

test('stripFrontmatter: 先頭の YAML frontmatter を除去し本文だけ残す', () => {
  const md = '---\ntitle: "T"\npublished: true\n---\n\n# 本文\n';
  assert.strictEqual(stripFrontmatter(md), '# 本文\n');
});

test('stripFrontmatter: frontmatter が無い本文はそのまま', () => {
  const md = '# 本文\n\n---\n\n区切り線の下\n';
  assert.strictEqual(stripFrontmatter(md), md);
});

test('stripFrontmatter: 閉じの --- が無い場合は frontmatter とみなさない', () => {
  const md = '---\ntitle: 閉じ忘れ\n本文が続く\n';
  assert.strictEqual(stripFrontmatter(md), md);
});

test('stripFrontmatter: 空の本文・--- のみでも壊れない', () => {
  assert.strictEqual(stripFrontmatter(''), '');
  assert.strictEqual(stripFrontmatter('---\n'), '---\n');
});

test('readMarkdown: CRLF 混在 + frontmatter 付きファイルを正規化して読む', () => {
  const dir = mkdtempSync(join(tmpdir(), 'memoreru-cli-files-'));
  const p = join(dir, 'a.md');
  writeFileSync(p, '---\r\ntitle: "T"\r\n---\r\n\r\n# 見出し\r\n本文\r\n', 'utf-8');
  assert.strictEqual(readMarkdown(p), '# 見出し\n本文\n');
});
