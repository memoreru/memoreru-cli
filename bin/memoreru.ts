#!/usr/bin/env node

/**
 * Memoreru CLI — sync local files with Memoreru
 *
 * Usage:
 *   memoreru init [dir] [--type page|table|slide|folder]
 *   memoreru push [dir] [--dry-run]
 *   memoreru pull [dir] [--dry-run]
 */

import { createRequire } from 'module';
import { Command } from 'commander';
import { configure } from '../src/lib/api.js';
import { printLogo } from '../src/lib/logo.js';
import { initCommand } from '../src/commands/init.js';
import { pushCommand } from '../src/commands/push.js';
import { pullCommand } from '../src/commands/pull.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

const program = new Command();

program
  .name('memoreru')
  .description('Sync local files with Memoreru')
  .version(version)
  .option('--api-key <key>', 'API key (overrides MEMORERU_API_KEY env var)')
  .option('--url <url>', 'Base URL (default: https://memoreru.com)')
  .hook('preAction', (thisCommand, actionCommand) => {
    // init はローカル操作のみ — APIキー不要
    if (actionCommand.name() === 'init') return;

    const opts = thisCommand.opts();
    const apiKey = opts.apiKey || process.env.MEMORERU_API_KEY;
    const baseUrl = (opts.url || process.env.MEMORERU_URL || 'https://memoreru.com').replace(/\/$/, '');

    if (!apiKey) {
      console.error('Error: API key is required.');
      console.error('  Set MEMORERU_API_KEY environment variable or use --api-key flag.');
      process.exit(1);
    }

    configure({ baseUrl, apiKey });
  });

program
  .command('init [directory]')
  .description('Initialize a new content directory')
  .option('-t, --type <type>', 'Content type (folder, page, table, slide, view, graph, dashboard)', 'page')
  .action(initCommand);

program
  .command('pull [directory]')
  .description('Pull content from Memoreru to local files')
  .option('-n, --preview', 'Preview changes without applying')
  .action(pullCommand);

program
  .command('push [directory]')
  .description('Push local content to Memoreru')
  .option('-n, --preview', 'Preview changes without applying')
  .action(pushCommand);

// 引数なし → ロゴ + ヘルプ
if (process.argv.length <= 2) {
  console.log();
  printLogo();
  console.log();
}

program.parse();
