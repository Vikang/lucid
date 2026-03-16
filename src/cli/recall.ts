/**
 * `lucid recall` — Search memories semantically.
 * Stub — coming in v0.1.
 */

import { Command } from 'commander';
import chalk from 'chalk';

export const recallCommand = new Command('recall')
  .description('Search memories semantically')
  .argument('[query]', 'Search query')
  .action(() => {
    console.log(chalk.yellow('⚡ lucid recall') + ' — Coming in v0.1');
    console.log('  Will perform semantic search over your memory store.');
  });
