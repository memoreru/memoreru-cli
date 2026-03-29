/**
 * ファイル I/O ユーティリティ
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { createHash } from 'crypto';

export function readMarkdown(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
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
