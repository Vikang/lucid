/**
 * `lucid dedup` — Find and merge duplicate memories.
 *
 * Scans all memories for near-duplicates using embedding similarity.
 * Default mode is dry-run (shows what would be merged).
 * Use --merge to actually remove duplicates.
 */

import { Command } from 'commander';
import { deduplicateAll } from '../core/dedup';
import { deleteMemory } from '../core/memory';
import { loadConfig } from '../config';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const dedupCommand = new Command('dedup')
  .description('Find and merge duplicate memories')
  .option('--merge', 'Actually merge duplicates (default is dry-run)')
  .option('--threshold <n>', 'Similarity threshold (0.0-1.0)', '0.92')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (
    opts: {
      merge?: boolean;
      threshold: string;
      json?: boolean;
    },
  ) => {
    const config = loadConfig();
    const threshold = parseFloat(opts.threshold);
    const isDryRun = !opts.merge;

    const report = await deduplicateAll(config, threshold);

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    if (report.duplicateGroups === 0) {
      console.log(chalk.green('✓') + ' No duplicates found');
      console.log(`  ${chalk.dim('Scanned:')} ${report.totalMemories} memories`);
      console.log(`  ${chalk.dim('Threshold:')} ${(threshold * 100).toFixed(0)}%`);
      return;
    }

    console.log(
      chalk.yellow('⚠') +
      ` Found ${report.duplicateGroups} duplicate group${report.duplicateGroups > 1 ? 's' : ''}` +
      ` across ${report.totalMemories} memories`,
    );
    console.log(`  ${chalk.dim('Threshold:')} ${(threshold * 100).toFixed(0)}%`);
    console.log();

    let totalRemoved = 0;

    for (let i = 0; i < report.groups.length; i++) {
      const group = report.groups[i];
      console.log(
        chalk.bold(`Group ${i + 1}`) +
        chalk.dim(` (${(group.similarity * 100).toFixed(1)}% similarity)`),
      );

      // Sort by importance descending — keep the highest
      const sorted = [...group.memories].sort((a, b) => b.importance - a.importance);
      const keeper = sorted[0];
      const toRemove = sorted.slice(1);

      for (const mem of sorted) {
        const isKeeper = mem.id === keeper.id;
        const prefix = isKeeper
          ? chalk.green('  ✓ KEEP')
          : chalk.red('  ✗ ' + (isDryRun ? 'WOULD REMOVE' : 'REMOVE'));
        const preview = mem.content.length > 80
          ? mem.content.slice(0, 80) + '...'
          : mem.content;
        console.log(`${prefix} ${chalk.dim(`[i=${mem.importance}]`)} ${preview}`);
        console.log(`    ${chalk.dim('id:')} ${mem.id}`);
      }

      if (!isDryRun) {
        for (const mem of toRemove) {
          await deleteMemory(mem.id, config);
          totalRemoved++;
        }
      }

      console.log();
    }

    if (isDryRun) {
      const wouldRemove = report.groups.reduce(
        (sum, g) => sum + g.memories.length - 1,
        0,
      );
      console.log(
        chalk.dim('Dry run — no changes made. ') +
        chalk.yellow(`Would remove ${wouldRemove} duplicate${wouldRemove > 1 ? 's' : ''}.`),
      );
      console.log(chalk.dim('Run with --merge to apply.'));
    } else {
      console.log(
        chalk.green('✓') +
        ` Removed ${totalRemoved} duplicate${totalRemoved > 1 ? 's' : ''}`,
      );
    }
  }));
