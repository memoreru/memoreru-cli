/**
 * 拡張設定（スクリプト/スタイル/カスタム処理）のファイルパス同期
 *
 * manifest の scripts[] がローカルのコードファイルをパス参照する。push はファイルを読んで
 * external canonical API（/api/contents/:id/scripts）へ送り、pull は code をファイルへ
 * 書き戻す。受託開発の管理・納品がファイルベースで完結する。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import {
  createScript,
  deleteScript,
  listScripts,
  type ScriptRecord,
  type ScriptType,
  updateScript,
} from './api.js';

/** manifest の scripts[] 要素 */
export interface ScriptManifestEntry {
  type: ScriptType;
  /** manifest ディレクトリからの相対パス（例: scripts/on-create.js） */
  file: string;
  title?: string;
  is_disabled?: boolean;
  execution_order?: string;
  triggers?: string[];
  /** push 後に書き戻される */
  script_id?: string;
}

/**
 * manifest ディレクトリ内に収まる絶対パスへ解決する（パストラバーサル防止）。
 * `file` が dirPath の外を指す場合はエラー。
 */
export function resolveScriptFilePath(dirPath: string, file: string): string {
  const base = resolve(dirPath);
  const target = resolve(base, file);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || resolve(base, rel) !== target) {
    throw new Error(`スクリプトファイルのパスがディレクトリ外を指しています: ${file}`);
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

/** push 計画: file_name（無ければ script_id）で既存とマッチし、作成/更新/削除に振り分ける */
export function planScriptSync(
  entries: ScriptManifestEntry[],
  existing: ScriptRecord[],
): {
  toCreate: ScriptManifestEntry[];
  toUpdate: Array<{ entry: ScriptManifestEntry; existing: ScriptRecord }>;
  toDelete: ScriptRecord[];
} {
  const byFile = new Map<string, ScriptRecord>();
  const byId = new Map<string, ScriptRecord>();
  for (const s of existing) {
    if (s.file_name) byFile.set(s.file_name, s);
    byId.set(s.script_id, s);
  }
  const toCreate: ScriptManifestEntry[] = [];
  const toUpdate: Array<{ entry: ScriptManifestEntry; existing: ScriptRecord }> = [];
  const matched = new Set<string>();
  for (const entry of entries) {
    const match =
      (entry.script_id ? byId.get(entry.script_id) : undefined) ?? byFile.get(entry.file);
    if (match) {
      toUpdate.push({ entry, existing: match });
      matched.add(match.script_id);
    } else {
      toCreate.push(entry);
    }
  }
  // manifest に無い既存スクリプトは削除候補（prune 時のみ実削除）
  const toDelete = existing.filter(s => !matched.has(s.script_id));
  return { toCreate, toUpdate, toDelete };
}

/** entry からタイトルを決める（未指定はファイル名のベース名） */
export function scriptTitleOf(entry: ScriptManifestEntry): string {
  if (entry.title && entry.title.trim()) return entry.title;
  const base = entry.file.split('/').pop() ?? entry.file;
  return base.replace(/\.[^.]+$/, '');
}

/** 既存スクリプトが entry と同一内容か（冪等 push: 変更なしは update をスキップ） */
function isScriptUnchanged(
  entry: ScriptManifestEntry,
  code: string,
  ex: ScriptRecord,
): boolean {
  if (code !== ex.code) return false;
  if (scriptTitleOf(entry) !== ex.title) return false;
  if (entry.file !== (ex.file_name ?? undefined)) return false;
  if ((entry.is_disabled ?? false) !== ex.is_disabled) return false;
  // execution_order は指定時のみ比較
  if (entry.execution_order !== undefined && entry.execution_order !== (ex.execution_order ?? undefined)) {
    return false;
  }
  // triggers は指定時のみ比較
  if (entry.triggers !== undefined && !sameTriggers(entry.triggers, triggerTypesOf(ex.triggers))) {
    return false;
  }
  return true;
}

/**
 * push: manifest の scripts[] をファイルから読んで API へ反映。
 * prune=true で manifest に無い既存スクリプトを削除する。
 * 戻り値は script_id を書き戻した更新後の entries。
 */
export async function pushScriptsForContent(
  contentId: string,
  dirPath: string,
  entries: ScriptManifestEntry[],
  opts: { prune?: boolean } = {},
): Promise<ScriptManifestEntry[]> {
  const existing = await listScripts(contentId);
  const { toCreate, toUpdate, toDelete } = planScriptSync(entries, existing);
  const resultById = new Map<string, string>(); // file -> script_id

  for (const entry of toCreate) {
    const code = readFileSync(resolveScriptFilePath(dirPath, entry.file), 'utf-8');
    const created = await createScript(contentId, {
      title: scriptTitleOf(entry),
      script_type: entry.type,
      code,
      file_name: entry.file,
      is_disabled: entry.is_disabled,
      execution_order: entry.execution_order,
      triggers: entry.triggers,
    });
    resultById.set(entry.file, created.script_id);
  }

  for (const { entry, existing: ex } of toUpdate) {
    const code = readFileSync(resolveScriptFilePath(dirPath, entry.file), 'utf-8');
    resultById.set(entry.file, ex.script_id);
    // 冪等: 変更が無ければ update しない（version の無駄な増加を防ぐ）
    if (isScriptUnchanged(entry, code, ex)) continue;
    await updateScript(contentId, ex.script_id, {
      version: ex.version,
      title: scriptTitleOf(entry),
      code,
      file_name: entry.file,
      is_disabled: entry.is_disabled,
      execution_order: entry.execution_order,
      triggers: entry.triggers,
    });
  }

  if (opts.prune) {
    for (const s of toDelete) {
      await deleteScript(contentId, s.script_id);
    }
  }

  return entries.map(e => ({ ...e, script_id: resultById.get(e.file) ?? e.script_id }));
}

/**
 * pull: API のスクリプトを取得し、file_name のパスへ code を書き出す。
 * 戻り値は manifest に書く scripts[] エントリ（execution_order / triggers も保持）。
 */
export async function pullScriptsForContent(
  contentId: string,
  dirPath: string,
): Promise<ScriptManifestEntry[]> {
  const scripts = await listScripts(contentId);
  const entries: ScriptManifestEntry[] = [];
  for (const s of scripts) {
    const file = s.file_name ?? defaultScriptFileName(s);
    const target = resolveScriptFilePath(dirPath, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, s.code, 'utf-8');
    const entry: ScriptManifestEntry = {
      type: s.script_type,
      file,
      title: s.title,
      is_disabled: s.is_disabled,
      script_id: s.script_id,
    };
    if (s.execution_order != null) entry.execution_order = s.execution_order;
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
      .slice(0, 80) || 'script'
  );
}

/** file_name を持たない既存スクリプトの既定ファイル名（type 別ディレクトリ + サニタイズ名） */
function defaultScriptFileName(s: ScriptRecord): string {
  const dir = s.script_type === 'style' ? 'styles' : 'scripts';
  const ext = s.script_type === 'style' ? 'css' : 'js';
  // 名前衝突を避けるため script_id 先頭を付与
  const base = sanitizeForFileName(s.title || s.script_id);
  return `${dir}/${base}-${s.script_id.slice(0, 8)}.${ext}`;
}
