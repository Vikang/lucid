/**
 * `lucid list` — List stored memories.
 */

import { Command } from 'commander';
import { listMemories } from '../core/memory';
import { loadConfig } from '../config';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const listCommand = new Command('list')
  .description('List stored memories')
  .option('--tag <tag>', 'Filter by tag')
  .option('-n, --limit <n>', 'Max results', '20')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (opts: { tag?: string; limit: string; json?: boolean }) => {
    const config = loadConfig();
    const limit = parseInt(opts.limit, 10);

    const memories = await listMemories(config, {
      tag: opts.tag,
      limit,
    });

    if (memories.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        const msg = opts.tag
          ? `No memories found with tag "${opts.tag}".`
          : 'No memories stored yet. Run `lucid curate` to extract memories from a conversation.';
        console.log(chalk.yellow(msg));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(memories, null, 2));
    } else {
      console.log(chalk.bold(`${memories.length} memories:\n`));
      for (const m of memories) {
        const preview = m.content.length > 80 ? m.content.slice(0, 80) + '…' : m.content;
        console.log(`  ${chalk.dim(m.id.slice(0, 8))}  ${preview}`);
        console.log(`  ${chalk.dim(`importance: ${m.importance} | tags: ${m.tags.join(', ') || 'none'} | ${m.temporalRelevance}`)}`);
        console.log();
      }
    }
  }));
