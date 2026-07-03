/**
 * ファイル I/O ユーティリティ
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

/**
 * push する markdown 本文を読み込む。
 * - CRLF を LF に正規化する
 * - 先頭の YAML frontmatter を除去する。frontmatter はツール向けのメタデータであり、
 *   ページ本文には含めない。
 */
export function readMarkdown(filePath: string): string {
  return stripFrontmatter(readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n'));
}

/**
 * 先頭の YAML frontmatter を除去する。
 * ファイルの 1 行目が `---` で、それ以降に閉じの `---` 単独行がある場合のみ除去
 * (本文中の水平線 `---` とは区別される。閉じが無い場合は frontmatter とみなさない)。
 */
export function stripFrontmatter(md: string): string {
  if (!md.startsWith('---\n')) return md;
  const lines = md.split('\n');
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      return lines
        .slice(i + 1)
        .join('\n')
        .replace(/^\n+/, '');
    }
  }
  return md;
}

export function writeMarkdown(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

export function readImageAsBase64(
  basePath: string,
  localPath: string,
): { data: string; mimeType: string } | null {
  const fullPath = join(basePath, localPath);
  if (!existsSync(fullPath)) return null;
  const ext = localPath.slice(localPath.lastIndexOf('.')).toLowerCase();
  return {
    data: readFileSync(fullPath).toString('base64'),
    mimeType: MIME_MAP[ext] ?? 'application/octet-stream',
  };
}

export function saveImage(basePath: string, localPath: string, buffer: Buffer): void {
  const fullPath = join(basePath, localPath);
  const dir = dirname(fullPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, buffer);
}

export function computeFileHash(basePath: string, localPath: string): string | null {
  const fullPath = join(basePath, localPath);
  if (!existsSync(fullPath)) return null;
  const data = readFileSync(fullPath);
  return createHash('sha256').update(data).digest('hex');
}
