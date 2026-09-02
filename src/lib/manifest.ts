/**
 * .memoreru.json 読み書きユーティリティ
 *
 * マニフェスト形式: 1ディレクトリの .memoreru.json に複数コンテンツのメタデータを格納。
 * ファイル名をキー、メタデータを値とする。
 *
 *   {
 *     "ページ名.md": { "title": "...", "category": "business", ... },
 *     "データ.csv": { "title": "...", ... },
 *     "フォルダ名": { "contentType": "folder", "title": "...", ... }
 *   }
 *
 * title は省略時にファイル名（拡張子除去）から自動推定。
 * contentType は省略時に拡張子から自動推定（.md→page, .csv→table）。
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { basename, extname, join } from 'path';

// =============================================================================
// 型定義
// =============================================================================

/** コンテンツのメタデータ */
export interface MemoreruMeta {
  contentId?: string;
  contentType:
    | 'page'
    | 'slide'
    | 'folder'
    | 'table'
    | 'graph'
    | 'dashboard'
    | 'view'
    | 'screen'
    | 'report'
    | 'workflow';
  title: string;
  systemType?: string;
  customOrder?: number;
  /**
   * table: 照合列 upsert に使う列（列名 or column_id）。この列の値で既存行を照合して
   * update/create する（row_id 不要）。列を rename する可能性があれば column_id 指定を推奨。
   */
  matchColumn?: string;
  [key: string]: unknown;
}

/** マニフェスト形式: ファイル名 → メタデータ */
export type MemoreruManifest = Record<string, Record<string, unknown>>;

const META_FILENAME = '.memoreru.json';

function warnLegacyManifest(filePath: string): void {
  console.warn(
    `⚠️ ${filePath} is in the legacy snake_case format. Rename manifest keys such as content_type to contentType before syncing.`,
  );
}

function hasLegacyManifestEntry(raw: object): boolean {
  return Object.values(raw).some(
    value =>
      typeof value === 'object' &&
      value !== null &&
      'content_type' in value &&
      !('contentType' in value),
  );
}

// =============================================================================
// 読み込み
// =============================================================================

/** .memoreru.json をマニフェストとして読み込む（単一コンテンツ形式の場合は null） */
export function readManifest(dirPath: string): MemoreruManifest | null {
  const filePath = join(dirPath, META_FILENAME);
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  if (typeof raw === 'object' && raw !== null) {
    if ('content_type' in raw) {
      warnLegacyManifest(filePath);
      return null;
    }
    if (hasLegacyManifestEntry(raw)) {
      warnLegacyManifest(filePath);
      return null;
    }
    if ('contentType' in raw) return null;
  }
  return raw as MemoreruManifest;
}

// =============================================================================
// メタデータ構築
// =============================================================================

/** 拡張子 → contentType 推定 */
function inferContentType(fileName: string): MemoreruMeta['contentType'] {
  const ext = extname(fileName).toLowerCase();
  if (ext === '.md') return 'page';
  if (ext === '.csv') return 'table';
  return 'page'; // フォールバック
}

/** マニフェストのエントリから MemoreruMeta を構築 */
export function buildMetaFromEntry(fileName: string, data: Record<string, unknown>): MemoreruMeta {
  const ext = extname(fileName).toLowerCase();
  const contentType = (data.contentType as string) ?? inferContentType(fileName);
  const title = (data.title as string) ?? basename(fileName, ext);

  return { ...data, contentType, title } as MemoreruMeta;
}

// =============================================================================
// 書き込み
// =============================================================================

/** マニフェストの特定エントリを更新または追加（contentId 書き戻し等） */
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
  if (typeof raw !== 'object' || raw === null) return null;
  if ('content_type' in raw) {
    warnLegacyManifest(filePath);
    return null;
  }
  if ('contentType' in raw) return raw as MemoreruMeta;
  return null;
}

/** 単一コンテンツ形式の .memoreru.json を書き込む（pull.ts 用） */
export function writeMeta(dirPath: string, meta: MemoreruMeta): void {
  const filePath = join(dirPath, META_FILENAME);
  writeFileSync(filePath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}
