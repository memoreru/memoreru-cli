/**
 * 拡張設定（Extensions: スタイル/スクリプト/カスタム処理）のファイルパス同期
 *
 * manifest の extensions[] がローカルのコードファイルをパス参照する。push はファイルを読んで
 * external canonical API（/api/v1/contents/:id/extensions）へ送り、pull は code をファイルへ
 * 書き戻す。受託開発の管理・納品がファイルベースで完結する。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  createExtension,
  deleteExtension,
  type ExtensionRecord,
  type ExtensionType,
  listExtensions,
  updateExtension,
} from './api.js';

/** manifest の extensions[] 要素 */
export interface ExtensionManifestEntry {
  type: ExtensionType;
  /** manifest ディレクトリからの相対パス（例: scripts/on-create.js） */
  file: string;
  title?: string;
  is_disabled?: boolean;
  execution_order?: string;
  triggers?: string[];
  /** push 後に書き戻される */
  extension_id?: string;
}

/**
 * manifest ディレクトリ内に収まる絶対パスへ解決する（パストラバーサル防止）。
 * `file` が dirPath の外を指す場合はエラー。
 */
export function resolveExtensionFilePath(dirPath: string, file: string): string {
  const base = resolve(dirPath);
  const target = resolve(base, file);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || resolve(base, rel) !== target) {
    throw new Error(`拡張設定ファイルのパスがディレクトリ外を指しています: ${file}`);
  }
  return target;
}

/** API のトリガー（オブジェクト配列）を trigger_type 文字列配列へ正規化 */
export function triggerTypesOf(triggers: unknown): string[] | undefined {
  if (!Array.isArray(triggers)) return undefined;
  const types = triggers
    .map(t =>
      t && typeof t === 'object' && 'trigger_type' in t
        ? String((t as { trigger_type: unknown }).trigger_type)
        : typeof t === 'string'
          ? t
          : null,
    )
    .filter((t): t is string => !!t);
  return types;
}

/** 2 つの trigger 集合が等しいか（順序非依存） */
function sameTriggers(a: string[] | undefined, b: string[] | undefined): boolean {
  const sa = [...(a ?? [])].sort();
  const sb = [...(b ?? [])].sort();
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

/** push 計画: fileName（無ければ manifest の extension_id）で既存とマッチし、作成/更新/削除に振り分ける */
export function planExtensionSync(
  entries: ExtensionManifestEntry[],
  existing: ExtensionRecord[],
): {
  toCreate: ExtensionManifestEntry[];
  toUpdate: Array<{ entry: ExtensionManifestEntry; existing: ExtensionRecord }>;
  toDelete: ExtensionRecord[];
} {
  const byFile = new Map<string, ExtensionRecord>();
  const byId = new Map<string, ExtensionRecord>();
  for (const s of existing) {
    if (s.fileName) byFile.set(s.fileName, s);
    byId.set(s.extensionId, s);
  }
  const toCreate: ExtensionManifestEntry[] = [];
  const toUpdate: Array<{ entry: ExtensionManifestEntry; existing: ExtensionRecord }> = [];
  const matched = new Set<string>();
  for (const entry of entries) {
    const match =
      (entry.extension_id ? byId.get(entry.extension_id) : undefined) ?? byFile.get(entry.file);
    if (match) {
      toUpdate.push({ entry, existing: match });
      matched.add(match.extensionId);
    } else {
      toCreate.push(entry);
    }
  }
  // manifest に無い既存は削除候補（prune 時のみ実削除）
  const toDelete = existing.filter(s => !matched.has(s.extensionId));
  return { toCreate, toUpdate, toDelete };
}

/** entry からタイトルを決める（未指定はファイル名のベース名） */
export function extensionTitleOf(entry: ExtensionManifestEntry): string {
  if (entry.title && entry.title.trim()) return entry.title;
  const base = entry.file.split('/').pop() ?? entry.file;
  return base.replace(/\.[^.]+$/, '');
}

/** 既存が entry と同一内容か（冪等 push: 変更なしは update をスキップ） */
function isExtensionUnchanged(
  entry: ExtensionManifestEntry,
  code: string,
  ex: ExtensionRecord,
): boolean {
  if (code !== ex.code) return false;
  if (extensionTitleOf(entry) !== ex.title) return false;
  if (entry.file !== (ex.fileName ?? undefined)) return false;
  if (entry.is_disabled !== undefined && entry.is_disabled !== ex.isDisabled) return false;
  if (
    entry.execution_order !== undefined &&
    entry.execution_order !== (ex.executionOrder ?? undefined)
  ) {
    return false;
  }
  if (entry.triggers !== undefined && !sameTriggers(entry.triggers, triggerTypesOf(ex.triggers))) {
    return false;
  }
  return true;
}

/**
 * push: manifest の extensions[] をファイルから読んで API へ反映。
 * prune=true で manifest に無い既存拡張設定を削除する。
 * 戻り値は extension_id を書き戻した更新後の entries。
 */
export async function pushExtensionsForContent(
  contentId: string,
  dirPath: string,
  entries: ExtensionManifestEntry[],
  opts: { prune?: boolean } = {},
): Promise<ExtensionManifestEntry[]> {
  const existing = await listExtensions(contentId);
  const { toCreate, toUpdate, toDelete } = planExtensionSync(entries, existing);
  const resultByFile = new Map<string, string>(); // file -> manifest extension_id

  for (const entry of toCreate) {
    const code = readFileSync(resolveExtensionFilePath(dirPath, entry.file), 'utf-8');
    const created = await createExtension(contentId, {
      title: extensionTitleOf(entry),
      type: entry.type,
      code,
      fileName: entry.file,
      isDisabled: entry.is_disabled,
      executionOrder: entry.execution_order,
      triggers: entry.triggers,
    });
    resultByFile.set(entry.file, created.extensionId);
  }

  for (const { entry, existing: ex } of toUpdate) {
    const code = readFileSync(resolveExtensionFilePath(dirPath, entry.file), 'utf-8');
    resultByFile.set(entry.file, ex.extensionId);
    // 冪等: 変更が無ければ update しない（version の無駄な増加を防ぐ）
    if (isExtensionUnchanged(entry, code, ex)) continue;
    await updateExtension(contentId, ex.extensionId, {
      version: ex.version,
      title: extensionTitleOf(entry),
      code,
      fileName: entry.file,
      isDisabled: entry.is_disabled,
      executionOrder: entry.execution_order,
      triggers: entry.triggers,
    });
  }

  if (opts.prune) {
    for (const s of toDelete) {
      await deleteExtension(contentId, s.extensionId);
    }
  }

  return entries.map(e => ({ ...e, extension_id: resultByFile.get(e.file) ?? e.extension_id }));
}

/**
 * pull: API の拡張設定を取得し、fileName のパスへ code を書き出す。
 * 戻り値は manifest に書く extensions[] エントリ（execution_order / triggers も保持）。
 */
export async function pullExtensionsForContent(
  contentId: string,
  dirPath: string,
): Promise<ExtensionManifestEntry[]> {
  const list = await listExtensions(contentId);
  const entries: ExtensionManifestEntry[] = [];
  for (const s of list) {
    const file = s.fileName ?? defaultExtensionFileName(s);
    const target = resolveExtensionFilePath(dirPath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, s.code, 'utf-8');
    const entry: ExtensionManifestEntry = {
      type: s.type,
      file,
      title: s.title,
      is_disabled: s.isDisabled,
      extension_id: s.extensionId,
    };
    if (s.executionOrder != null) entry.execution_order = s.executionOrder;
    const triggers = triggerTypesOf(s.triggers);
    if (triggers && triggers.length > 0) entry.triggers = triggers;
    entries.push(entry);
  }
  return entries;
}

/** ファイル名として安全な文字列へ（パス区切り・制御文字・空白を除去） */
function sanitizeForFileName(name: string): string {
  return (
    name
      .trim()
      .replace(/[\/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^\.+/, '')
      .slice(0, 80) || 'extension'
  );
}

/** fileName を持たない既存拡張設定の既定ファイル名（type 別ディレクトリ + サニタイズ名） */
function defaultExtensionFileName(s: ExtensionRecord): string {
  const dir = s.type === 'style' ? 'styles' : 'scripts';
  const ext = s.type === 'style' ? 'css' : 'js';
  const base = sanitizeForFileName(s.title || s.extensionId);
  return `${dir}/${base}-${s.extensionId.slice(0, 8)}.${ext}`;
}
