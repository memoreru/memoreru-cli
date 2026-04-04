/**
 * Memoreru CLI — 認証情報管理
 *
 * ~/.config/memoreru/credentials.json を読み書きする。
 * パーミッション 600 で保存（Windows ではスキップ）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface Profile {
  /** 署名付きセッションクッキー値（better-auth.session_token の値） */
  cookie: string;
  /** API の base URL */
  base_url: string;
  /** ユーザー ID */
  user_id: string;
  /** メールアドレス */
  email: string;
  /** 表示名 */
  name: string;
  /** テナント ID */
  tenant_id: string;
  /** プロファイル作成日時（ISO 8601） */
  created_at: string;
}

export interface CredentialsFile {
  version: 1;
  profiles: Record<string, Profile>;
}

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

export function getCredentialsPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  return join(configHome, 'memoreru', 'credentials.json');
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

export function readCredentials(): CredentialsFile | null {
  const filePath = getCredentialsPath();
  if (!existsSync(filePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (raw?.version === 1 && raw?.profiles) return raw as CredentialsFile;
    return null;
  } catch {
    return null;
  }
}

export function writeCredentials(creds: CredentialsFile): void {
  const filePath = getCredentialsPath();
  const dir = dirname(filePath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    if (process.platform !== 'win32') {
      chmodSync(dir, 0o700);
    }
  }

  writeFileSync(filePath, JSON.stringify(creds, null, 2) + '\n', 'utf-8');

  if (process.platform !== 'win32') {
    chmodSync(filePath, 0o600);
  }
}

// ---------------------------------------------------------------------------
// プロファイル操作
// ---------------------------------------------------------------------------

function ensureCredentials(): CredentialsFile {
  return readCredentials() ?? { version: 1, profiles: {} };
}

export function getProfile(name?: string): Profile | null {
  const creds = readCredentials();
  if (!creds) return null;
  const profileName = name || 'default';
  return creds.profiles[profileName] ?? null;
}

export function setProfile(name: string, profile: Profile): void {
  const creds = ensureCredentials();
  creds.profiles[name] = profile;
  writeCredentials(creds);
}

export function deleteProfile(name: string): void {
  const creds = readCredentials();
  if (!creds) return;
  delete creds.profiles[name];
  writeCredentials(creds);
}

export function clearCredentials(): void {
  const filePath = getCredentialsPath();
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}
