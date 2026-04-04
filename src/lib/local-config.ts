/**
 * Memoreru CLI — ローカル設定ファイル読み取り
 *
 * 各ディレクトリの .memoreru-config.json からプロファイル名等を読み取る。
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const CONFIG_FILENAME = '.memoreru-config.json';

export interface LocalConfig {
  /** 使用するプロファイル名 */
  profile?: string;
}

/**
 * 指定ディレクトリ（またはカレントディレクトリ）の .memoreru-config.json を読み取る。
 * ファイルが存在しない場合は null を返す。
 */
export function readLocalConfig(dir?: string): LocalConfig | null {
  const configPath = join(dir || process.cwd(), CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as LocalConfig;
  } catch {
    return null;
  }
}
