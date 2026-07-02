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

/** push 計画: file_name（無ければ script_id）で既存とマッチし、作成/更新に振り分ける */
export function planScriptSync(
  entries: ScriptManifestEntry[],
  existing: ScriptRecord[],
): {
  toCreate: ScriptManifestEntry[];
  toUpdate: Array<{ entry: ScriptManifestEntry; existing: ScriptRecord }>;
} {
  const byFile = new Map<string, ScriptRecord>();
  const byId = new Map<string, ScriptRecord>();
  for (const s of existing) {
    if (s.file_name) byFile.set(s.file_name, s);
    byId.set(s.script_id, s);
  }
  const toCreate: ScriptManifestEntry[] = [];
  const toUpdate: Array<{ entry: ScriptManifestEntry; existing: ScriptRecord }> = [];
  for (const entry of entries) {
    const match =
      (entry.script_id ? byId.get(entry.script_id) : undefined) ?? byFile.get(entry.file);
    if (match) toUpdate.push({ entry, existing: match });
    else toCreate.push(entry);
  }
  return { toCreate, toUpdate };
}

/** entry からタイトルを決める（未指定はファイル名のベース名） */
export function scriptTitleOf(entry: ScriptManifestEntry): string {
  if (entry.title && entry.title.trim()) return entry.title;
  const base = entry.file.split('/').pop() ?? entry.file;
  return base.replace(/\.[^.]+$/, '');
}

/**
 * push: manifest の scripts[] をファイルから読んで API へ反映。
 * 戻り値は script_id を書き戻した更新後の entries。
 */
export async function pushScriptsForContent(
  contentId: string,
  dirPath: string,
  entries: ScriptManifestEntry[],
): Promise<ScriptManifestEntry[]> {
  const existing = await listScripts(contentId);
  const { toCreate, toUpdate } = planScriptSync(entries, existing);
  const resultById = new Map<string, string>(); // file -> script_id

  for (const entry of toCreate) {
    const code = readFileSync(resolveScriptFilePath(dirPath, entry.file), 'utf-8');
    const created = await createScript(contentId, {
      title: scriptTitleOf(entry),
      script_type: entry.type,
      code,
      file_name: entry.file,
      is_disabled: entry.is_disabled,
      triggers: entry.triggers,
    });
    resultById.set(entry.file, created.script_id);
  }

  for (const { entry, existing: ex } of toUpdate) {
    const code = readFileSync(resolveScriptFilePath(dirPath, entry.file), 'utf-8');
    await updateScript(contentId, ex.script_id, {
      version: ex.version,
      title: scriptTitleOf(entry),
      code,
      file_name: entry.file,
      is_disabled: entry.is_disabled,
      execution_order: entry.execution_order,
      triggers: entry.triggers,
    });
    resultById.set(entry.file, ex.script_id);
  }

  return entries.map(e => ({ ...e, script_id: resultById.get(e.file) ?? e.script_id }));
}

/**
 * pull: API のスクリプトを取得し、file_name のパスへ code を書き出す。
 * 戻り値は manifest に書く scripts[] エントリ。
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
    entries.push({
      type: s.script_type,
      file,
      title: s.title,
      is_disabled: s.is_disabled,
      script_id: s.script_id,
    });
  }
  return entries;
}

/** file_name を持たない既存スクリプトの既定ファイル名（type 別ディレクトリ + script_id） */
function defaultScriptFileName(s: ScriptRecord): string {
  const dir = s.script_type === 'style' ? 'styles' : 'scripts';
  const ext = s.script_type === 'style' ? 'css' : 'js';
  return join(dir, `${s.title || s.script_id}.${ext}`).replace(/\\/g, '/');
}
