/**
 * .memoreru.json 読み書きユーティリティ
 *
 * マニフェスト形式: 1ディレクトリの .memoreru.json に複数コンテンツのメタデータを格納。
 * ファイル名をキー、メタデータを値とする。
 *
 *   {
 *     "ページ名.md": { "title": "...", "category": "business", ... },
 *     "データ.csv": { "title": "...", ... },
 *     "フォルダ名": { "content_type": "folder", "title": "...", ... }
 *   }
 *
 * title は省略時にファイル名（拡張子除去）から自動推定。
 * content_type は省略時に拡張子から自動推定（.md→page, .csv→table）。
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';

// =============================================================================
// 型定義
// =============================================================================

/** コンテンツのメタデータ */
export interface MemoreruMeta {
  content_id?: string;
  content_type: 'page' | 'slide' | 'folder' | 'table' | 'graph' | 'dashboard' | 'view';
  title: string;
  system_type?: string;
  custom_order?: number;
  [key: string]: unknown;
}

/** マニフェスト形式: ファイル名 → メタデータ */
export type MemoreruManifest = Record<string, Record<string, unknown>>;

const META_FILENAME = '.memoreru.json';

// =============================================================================
// 読み込み
// =============================================================================

/** .memoreru.json をマニフェストとして読み込む（旧形式の場合は null） */
export function readManifest(dirPath: string): MemoreruManifest | null {
  const filePath = join(dirPath, META_FILENAME);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  // 旧形式（トップレベルに content_type がある）はマニフェストではない
  if (typeof raw === 'object' && raw !== null && 'content_type' in raw) return null;
  return raw as MemoreruManifest;
}

// =============================================================================
// メタデータ構築
// =============================================================================

/** 拡張子 → content_type 推定 */
function inferContentType(fileName: string): MemoreruMeta['content_type'] {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.md') return 'page';
  if (ext === '.csv') return 'table';
  return 'page'; // フォールバック
}

/** マニフェストのエントリから MemoreruMeta を構築 */
export function buildMetaFromEntry(fileName: string, data: Record<string, unknown>): MemoreruMeta {
  const ext = extname(fileName).toLowerCase();
  const contentType = (data.content_type as string) ?? inferContentType(fileName);
  const title = (data.title as string) ?? basename(fileName, ext);

  return { ...data, content_type: contentType, title } as MemoreruMeta;
}

// =============================================================================
// 書き込み
// =============================================================================

/** マニフェストの特定エントリを更新または追加（content_id 書き戻し等） */
export function updateManifestEntry(dirPath: string, fileName: string, updates: Record<string, unknown>): void {
  const filePath = join(dirPath, META_FILENAME);
  if (!existsSync(filePath)) return;
  const manifest = JSON.parse(readFileSync(filePath, 'utf-8')) as MemoreruManifest;
  if (fileName in manifest) {
    Object.assign(manifest[fileName], updates);
  } else {
    manifest[fileName] = { ...updates };
  }
  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
}

// =============================================================================
// ヘルパー
// =============================================================================

export function getBodyPath(dirPath: string): string {
  return join(dirPath, 'body.md');
}

export function readMeta(dirPath: string): MemoreruMeta | null {
  const filePath = join(dirPath, META_FILENAME);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  // マニフェスト形式かどうかを content_type の有無で判定
  if ('content_type' in raw) return raw as MemoreruMeta;
  return null;
}

/** 単一コンテンツ形式の .memoreru.json を書き込む（pull.ts 用） */
export function writeMeta(dirPath: string, meta: MemoreruMeta): void {
  const filePath = join(dirPath, META_FILENAME);
  writeFileSync(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}
