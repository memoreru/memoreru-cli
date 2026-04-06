#!/usr/bin/env node

/**
 * Memoreru CLI — sync local files with Memoreru
 *
 * Usage:
 *   memoreru login [--profile <name>]       (or: mem login)
 *   memoreru logout [--profile <name>] [--all]
 *   memoreru keys create|list|revoke
 *   memoreru init [dir] [--type page|table|slide|folder]
 *   memoreru push [dir] [--preview] [--profile <name>]
 *   memoreru pull [dir] [--preview] [--profile <name>]
 *   memoreru status [dir]
 *   memoreru diff [dir] [--file <filename>]
 *
 * The "mem" shorthand is available as an alias for "memoreru".
 */

import { createRequire } from 'module';
import { Command } from 'commander';
import { configure } from '../src/lib/api.js';
import { getProfile } from '../src/lib/credentials.js';
import { readLocalConfig } from '../src/lib/local-config.js';
import { printLogo } from '../src/lib/logo.js';
import { diffCommand } from '../src/commands/diff.js';
import { initCommand } from '../src/commands/init.js';
import { keysCreateCommand, keysListCommand, keysRevokeCommand } from '../src/commands/keys.js';
import { loginCommand, logoutCommand } from '../src/commands/login.js';
import { pushCommand } from '../src/commands/push.js';
import { pullCommand } from '../src/commands/pull.js';
import { statusCommand } from '../src/commands/status.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name(process.argv[1]?.endsWith('/mem') || process.argv[1]?.endsWith('\\mem') ? 'mem' : 'memoreru')
  .description('Sync local files with Memoreru')
  .addHelpText('after', '\nAlias: "mem" can be used as a shorthand for "memoreru"')
  .version(version)
  .option('--api-key <key>', 'API key (overrides MEMORERU_API_KEY env var)')
  .option('--url <url>', 'Base URL (default: https://memoreru.com)')
  .option('--profile <name>', 'Credential profile name')
  .hook('preAction', (thisCommand, actionCommand) => {
    const name = actionCommand.name();

    // ローカル操作のみのコマンド — 認証不要
    if (['init', 'status', 'diff', 'login', 'logout', 'keys'].includes(name)) return;

    const opts = thisCommand.opts();
    const baseUrl = (opts.url || process.env.MEMORERU_URL || 'https://memoreru.com').replace(/\/$/, '');

    // keys サブコマンドはセッション認証必須
    const isKeysCommand = actionCommand.parent?.name() === 'keys';
    if (isKeysCommand) {
      const profileName = opts.profile || 'default';
      const profile = getProfile(profileName);
      if (!profile?.cookie) {
        console.error('Error: セッションが必要です。先に memoreru login を実行してください。');
        process.exit(1);
      }
      configure({ baseUrl: profile.base_url || baseUrl, sessionCookie: profile.cookie });
      return;
    }

    // push/pull: --api-key → MEMORERU_API_KEY → --profile → .memoreru-config.json → default
    const apiKey = opts.apiKey || process.env.MEMORERU_API_KEY;
    if (apiKey) {
      configure({ baseUrl, apiKey });
      return;
    }

    // プロファイル解決: --profile → .memoreru-config.json → default
    const dir = actionCommand.args?.[0] as string | undefined;
    const profileName = opts.profile || readLocalConfig(dir)?.profile || 'default';
    const profile = getProfile(profileName);
    if (profile?.cookie) {
      configure({ baseUrl: profile.base_url || baseUrl, sessionCookie: profile.cookie });
      return;
    }

    console.error('Error: 認証情報が必要です。');
    console.error('  memoreru login を実行するか、');
    console.error('  MEMORERU_API_KEY 環境変数または --api-key フラグを使用してください。');
    process.exit(1);
  });

program
  .command('login')
  .description('Log in to Memoreru')
  .option('--profile <name>', 'Profile name to save (default: "default")')
  .option('--port <port>', 'Force specific localhost port for callback')
  .action((opts, cmd) => loginCommand({ ...cmd.parent?.opts(), ...opts }));

program
  .command('logout')
  .description('Clear stored session')
  .option('--profile <name>', 'Profile to logout (default: "default")')
  .option('--all', 'Clear all profiles')
  .action(logoutCommand);

const keys = program.command('keys').description('Manage API keys');

keys
  .command('create')
  .description('Create a new API key')
  .option('--name <name>', 'Key name (default: "CLI YYYY-MM-DD")')
  .option('--read-only', 'Read-only scope (api:read only)')
  .option('--profile <name>', 'Session profile to use')
  .action(keysCreateCommand);

keys
  .command('list')
  .description('List API keys')
  .option('--profile <name>', 'Session profile to use')
  .action(keysListCommand);

keys
  .command('revoke <prefix>')
  .description('Revoke an API key by prefix or ID')
  .option('--profile <name>', 'Session profile to use')
  .action(keysRevokeCommand);

program
  .command('init [directory]')
  .description('Initialize a new content directory')
  .option('-t, --type <type>', 'Content type (folder, page, table, slide, view, graph, dashboard)', 'page')
  .action(initCommand);

program
  .command('pull [directory]')
  .description('Pull content from Memoreru to local files')
  .option('-n, --preview', 'Preview changes without applying')
  .option('--profile <name>', 'Credential profile to use')
  .action(pullCommand);

program
  .command('push [directory]')
  .description('Push local content to Memoreru')
  .option('-n, --preview', 'Preview changes without applying')
  .option('--profile <name>', 'Credential profile to use')
  .action(pushCommand);

program
  .command('status [directory]')
  .description('Show local changes since last pull/push')
  .action(statusCommand);

program
  .command('diff [directory]')
  .description('Show diff of modified files')
  .option('-f, --file <filename>', 'Show diff for a specific file only')
  .action(diffCommand);

// 引数なし → ロゴ + ヘルプを表示して正常終了
if (process.argv.length <= 2) {
  console.log();
  printLogo();
  console.log();
  program.outputHelp();
  process.exit(0);
}

program.parse();
