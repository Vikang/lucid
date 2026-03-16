/**
 * `lucid import openclaw` — Bulk import OpenClaw sessions into Lucid.
 */

import { Command } from 'commander';
import { loadConfig } from '../config';
import { importOpenClaw } from '../import/engine';
import { wrapAction } from '../utils/cli-wrapper';
import { existsSync } from 'node:fs';
import { getDefaultOpenClawDir } from '../import/openclaw';

// ─── import openclaw ─────────────────────────────────────────────────

const openclawCommand = new Command('openclaw')
  .description('Import conversations from OpenClaw session history')
  .option('--path <dir>', 'Override OpenClaw directory (default: ~/.openclaw)')
  .option('--agent <agents>', 'Comma-separated agent filter')
  .option('--channel <channels>', 'Comma-separated channel filter')
  .option('--since <date>', 'Only sessions after this date (YYYY-MM-DD)')
  .option('--dry-run', 'Show what would be imported without doing it')
  .option('--yes', 'Skip confirmation prompt')
  .option('--verbose', 'Show per-session details')
  .option('--json', 'Output results as JSON')
  .action(wrapAction(async (opts: {
    path?: string;
    agent?: string;
    channel?: string;
    since?: string;
    dryRun?: boolean;
    yes?: boolean;
    verbose?: boolean;
    json?: boolean;
  }) => {
    const config = loadConfig();
    const openclawDir = opts.path ?? getDefaultOpenClawDir();

    // Check if OpenClaw directory exists
    if (!existsSync(openclawDir)) {
      if (opts.json) {
        console.log(JSON.stringify({ error: 'OpenClaw directory not found', path: openclawDir }, null, 2));
      } else {
        console.error(`OpenClaw directory not found: ${openclawDir}`);
        console.error('Make sure OpenClaw is installed and has session data.');
        console.error('You can specify a custom path with --path <dir>');
      }
      return;
    }

    const result = await importOpenClaw(config, {
      openclawDir: opts.path,
      agents: opts.agent ? opts.agent.split(',').map((a) => a.trim()) : undefined,
      channels: opts.channel ? opts.channel.split(',').map((c) => c.trim()) : undefined,
      since: opts.since,
      dryRun: opts.dryRun,
      yes: opts.yes,
      verbose: opts.verbose,
    });

    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    }
  }));

// ─── import command group ────────────────────────────────────────────

export const importCommand = new Command('import')
  .description('Import conversations from external sources')
  .addCommand(openclawCommand);
