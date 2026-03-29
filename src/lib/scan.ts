/**
 * ディレクトリスキャンユーティリティ
 *
 * .memoreru.json（マニフェスト形式）に明示的に記載されたコンテンツのみを収集する。
 * フォルダの中身を暗黙的にアップロードすることはない。
 *
 * サブディレクトリに .memoreru.json がある場合はそのディレクトリもスキャンする。
 * これにより、ディレクトリ階層を自由に構成しつつ、各階層で何をアップロードするか
 * 明示的に制御できる。
 */

import { existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { buildMetaFromEntry, readManifest, type MemoreruMeta } from './manifest.js';

/** スキャン結果 */
export interface ScanEntry {
  /** ディレクトリパス */
  dirPath: string;
  /** コンテンツファイル名（フォルダの場合は undefined） */
  fileName?: string;
  /** メタデータ */
  meta: MemoreruMeta;
  /** 親フォルダの content_id（スキャン時に自動解決） */
  parentContentId?: string;
}

const MAX_DEPTH = 10;

/**
 * ディレクトリをスキャンし、.memoreru.json に明示されたコンテンツを収集する。
 * サブディレクトリに .memoreru.json がある場合は再帰的にスキャンする。
 */
export function scanDirectory(dirPath: string, parentContentId?: string, depth = 0): ScanEntry[] {
  if (depth > MAX_DEPTH) return [];
  const entries: ScanEntry[] = [];
  const manifest = readManifest(dirPath);

  if (manifest) {
    // マニフェストに記載されたエントリを処理
    const folderContentIds = new Map<string, string>();

    for (const [fileName, fileMeta] of Object.entries(manifest)) {
      const meta = buildMetaFromEntry(fileName, fileMeta);

      if (meta.content_type === 'folder') {
        // フォルダエントリ: コンテンツとして登録（中身は再帰スキャンしない）
        const folderPath = join(dirPath, fileName);
        entries.push({ dirPath: folderPath, meta, parentContentId });
        if (meta.content_id) {
          folderContentIds.set(fileName, meta.content_id);
        }
      } else {
        // ファイルエントリ
        entries.push({ dirPath, fileName, meta, parentContentId });
      }
    }

    // サブディレクトリに .memoreru.json がある場合のみ再帰スキャン
    for (const name of listChildDirNames(dirPath)) {
      const childDir = join(dirPath, name);
      if (existsSync(join(childDir, '.memoreru.json'))) {
        const childParent = folderContentIds.get(name) ?? parentContentId;
        entries.push(...scanDirectory(childDir, childParent, depth + 1));
      }
    }
  } else {
    // .memoreru.json なし → サブディレクトリに .memoreru.json があれば探索
    for (const name of listChildDirNames(dirPath)) {
      const childDir = join(dirPath, name);
      if (existsSync(join(childDir, '.memoreru.json'))) {
        entries.push(...scanDirectory(childDir, parentContentId, depth + 1));
      }
    }
  }

  return entries;
}

/**
 * ディレクトリ直下のサブディレクトリ名一覧を取得
 * 隠しディレクトリ・node_modules・images は除外
 */
function listChildDirNames(dirPath: string): string[] {
  try {
    return readdirSync(dirPath)
      .filter(name => !name.startsWith('.') && name !== 'node_modules' && name !== 'images')
      .filter(name => {
        try {
          return statSync(join(dirPath, name)).isDirectory();
        } catch {
          return false;
        }
      });
  } catch {
    return [];
  }
}
