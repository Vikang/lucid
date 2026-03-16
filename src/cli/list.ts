/**
 * `lucid list` — List stored memories.
 * Stub — coming in v0.1.
 */

import { Command } from 'commander';
import chalk from 'chalk';

export const listCommand = new Command('list')
  .description('List stored memories')
  .action(() => {
    console.log(chalk.yellow('⚡ lucid list') + ' — Coming in v0.1');
    console.log('  Will display all stored memories with filtering options.');
  });
