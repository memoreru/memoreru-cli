/**
 * .memoreru/ 状態管理
 *
 * pull/push 時にスナップショット（ボディコピー）とハッシュを保存し、
 * memoreru status / diff でローカル変更を検知する基盤。
 *
 * .memoreru/
 * ├── state.json              # content_id → スナップショット情報
 * └── snapshots/              # pull/push 時のボディコピー
 *     ├── {content_id}.md
 *     ├── {content_id}.csv
 *     └── {content_id}.json
 */

import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, posix } from 'path';
import type { ScanEntry } from './scan.js';

// =============================================================================
// 型定義
// =============================================================================

export interface StateFile {
  version: 1;
  contents: Record<string, ContentSnapshot>;
}

export interface ContentSnapshot {
  /** ボディの SHA-256 */
  bodyHash: string;
  /** メタデータの SHA-256 */
  metaHash: string;
  /** ルートからの相対パス（/ 区切り） */
  localPath: string;
  contentType: string;
  title: string;
  /** 最後に同期した日時（ISO 8601） */
  syncedAt: string;
}

export type FileStatus = 'new' | 'modified' | 'unchanged' | 'deleted' | 'corrupted' | 'missing';

export interface StatusEntry {
  status: FileStatus;
  localPath: string;
  contentType: string;
  title: string;
  contentId?: string;
  /** modified の場合の詳細: 'body' | 'meta' | 'both' */
  detail?: string;
}

// =============================================================================
// ハッシュ関連のフィールド定義
// =============================================================================

/** metaHash 計算対象のフィールド（安定した順序で列挙） */
const META_HASH_FIELDS = [
  'category', 'content_type', 'description', 'emoji', 'label', 'language',
  'persons', 'publish_status', 'scope', 'slug', 'tags', 'title',
] as const;

// =============================================================================
// パスユーティリティ
// =============================================================================

/** content_type → スナップショットの拡張子 */
function contentTypeToExt(contentType: string): string {
  switch (contentType) {
    case 'page':
    case 'slide':
      return '.md';
    case 'table':
      return '.csv';
    case 'view':
    case 'graph':
    case 'dashboard':
      return '.json';
    default:
      return '';
  }
}

/** .memoreru/ ディレクトリのパス（必要なら作成） */
function ensureMemoreruDir(projectRoot: string): string {
  const dir = join(projectRoot, '.memoreru');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** .memoreru/snapshots/ ディレクトリのパス（必要なら作成） */
function ensureSnapshotsDir(projectRoot: string): string {
  const dir = join(projectRoot, '.memoreru', 'snapshots');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** ScanEntry からルート相対パスを算出（/ 区切りに正規化） */
export function resolveLocalPath(projectRoot: string, entry: ScanEntry): string {
  const fullPath = entry.fileName
    ? join(entry.dirPath, entry.fileName)
    : entry.dirPath;
  return relative(projectRoot, fullPath).split('\\').join(posix.sep);
}

// =============================================================================
// ハッシュ計算
// =============================================================================

/** 文字列の SHA-256 ハッシュを計算 */
export function computeBodyHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** メタデータの決定論的ハッシュを計算（キーをソートして JSON 化） */
export function computeMetaHash(meta: Record<string, unknown>): string {
  const picked: Record<string, unknown> = {};
  for (const key of META_HASH_FIELDS) {
    if (meta[key] !== undefined) {
      picked[key] = meta[key];
    }
  }
  const json = JSON.stringify(picked);
  return createHash('sha256').update(json, 'utf-8').digest('hex');
}

// =============================================================================
// state.json 読み書き
// =============================================================================

/** state.json を読み込む（存在しなければデフォルト値） */
export function readState(projectRoot: string): StateFile {
  const filePath = join(projectRoot, '.memoreru', 'state.json');
  if (!existsSync(filePath)) {
    return { version: 1, contents: {} };
  }
  return JSON.parse(readFileSync(filePath, 'utf-8')) as StateFile;
}

/** state.json を書き込む */
export function writeState(projectRoot: string, state: StateFile): void {
  ensureMemoreruDir(projectRoot);
  const filePath = join(projectRoot, '.memoreru', 'state.json');
  writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// =============================================================================
// スナップショット読み書き
// =============================================================================

/** スナップショットを保存 */
export function saveSnapshot(
  projectRoot: string,
  contentId: string,
  contentType: string,
  body: string,
): void {
  const ext = contentTypeToExt(contentType);
  if (!ext) return; // folder 等はスナップショット不要
  const dir = ensureSnapshotsDir(projectRoot);
  writeFileSync(join(dir, `${contentId}${ext}`), body, 'utf-8');
}

/** スナップショットを読み込む（存在しなければ null） */
export function readSnapshot(
  projectRoot: string,
  contentId: string,
  contentType: string,
): string | null {
  const ext = contentTypeToExt(contentType);
  if (!ext) return null;
  const filePath = join(projectRoot, '.memoreru', 'snapshots', `${contentId}${ext}`);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, 'utf-8');
}

// =============================================================================
// 同期後の更新
// =============================================================================

/**
 * スナップショットを保存し、ステートオブジェクトを更新する（ファイル書き込みはしない）。
 * 呼び出し側で最後に writeState() を1回だけ呼ぶこと。
 */
export function prepareSyncState(
  projectRoot: string,
  state: StateFile,
  contentId: string,
  entry: ScanEntry,
  body: string,
): void {
  saveSnapshot(projectRoot, contentId, entry.meta.content_type, body);

  state.contents[contentId] = {
    bodyHash: computeBodyHash(body),
    metaHash: computeMetaHash(entry.meta as Record<string, unknown>),
    localPath: resolveLocalPath(projectRoot, entry),
    contentType: entry.meta.content_type,
    title: entry.meta.title,
    syncedAt: new Date().toISOString(),
  };
}

/** pull/push 成功後にスナップショットと state.json を更新（単発用の便利関数） */
export function updateStateAfterSync(
  projectRoot: string,
  contentId: string,
  entry: ScanEntry,
  body: string,
): void {
  const state = readState(projectRoot);
  prepareSyncState(projectRoot, state, contentId, entry, body);
  writeState(projectRoot, state);
}

// =============================================================================
// エントリ分類（status / diff の共通ロジック）
// =============================================================================

/** ScanEntry[] を state.json と比較して StatusEntry[] に分類 */
export function classifyEntries(projectRoot: string, entries: ScanEntry[]): StatusEntry[] {
  const state = readState(projectRoot);
  const result: StatusEntry[] = [];
  const seenContentIds = new Set<string>();

  for (const entry of entries) {
    const contentId = entry.meta.content_id;
    const localPath = resolveLocalPath(projectRoot, entry);
    const contentType = entry.meta.content_type;
    const title = entry.meta.title;

    // content_id がない → 未 push の新規コンテンツ
    if (!contentId) {
      result.push({ status: 'new', localPath, contentType, title });
      continue;
    }

    seenContentIds.add(contentId);
    const snapshot = state.contents[contentId];

    // state.json にない → push 済みだがベースラインなし
    if (!snapshot) {
      result.push({ status: 'new', localPath, contentType, title, contentId });
      continue;
    }

    // folder はボディがないので metaHash のみ比較
    if (contentType === 'folder') {
      const currentMetaHash = computeMetaHash(entry.meta as Record<string, unknown>);
      const status = currentMetaHash !== snapshot.metaHash ? 'modified' : 'unchanged';
      result.push({ status, localPath, contentType, title, contentId, detail: status === 'modified' ? 'meta' : undefined });
      continue;
    }

    // スナップショットの整合性チェック
    const snapshotContent = readSnapshot(projectRoot, contentId, contentType);
    if (snapshotContent !== null) {
      const snapshotHash = computeBodyHash(snapshotContent);
      if (snapshotHash !== snapshot.bodyHash) {
        result.push({ status: 'corrupted', localPath, contentType, title, contentId });
        continue;
      }
    }

    // ローカルファイルのハッシュを計算
    const filePath = entry.fileName
      ? join(entry.dirPath, entry.fileName)
      : join(entry.dirPath, 'body.md');
    if (!existsSync(filePath)) {
      result.push({ status: 'missing', localPath, contentType, title, contentId });
      continue;
    }
    const currentBodyHash = computeBodyHash(readFileSync(filePath, 'utf-8'));

    const currentMetaHash = computeMetaHash(entry.meta as Record<string, unknown>);
    const bodyChanged = currentBodyHash !== snapshot.bodyHash;
    const metaChanged = currentMetaHash !== snapshot.metaHash;

    if (bodyChanged || metaChanged) {
      const detail = bodyChanged && metaChanged ? 'both' : bodyChanged ? 'body' : 'meta';
      result.push({ status: 'modified', localPath, contentType, title, contentId, detail });
    } else {
      result.push({ status: 'unchanged', localPath, contentType, title, contentId });
    }
  }

  // state.json にあるが scan で見つからないエントリ → deleted
  for (const [contentId, snapshot] of Object.entries(state.contents)) {
    if (!seenContentIds.has(contentId)) {
      result.push({
        status: 'deleted',
        localPath: snapshot.localPath,
        contentType: snapshot.contentType,
        title: snapshot.title,
        contentId,
      });
    }
  }

  return result;
}
