/**
 * `lucid curate` — Extract memories from a conversation transcript.
 * Stub — coming in v0.1.
 */

import { Command } from 'commander';
import chalk from 'chalk';

export const curateCommand = new Command('curate')
  .description('Extract memories from a conversation transcript')
  .action(() => {
    console.log(chalk.yellow('⚡ lucid curate') + ' — Coming in v0.1');
    console.log('  Will parse transcripts and extract structured memories via LLM.');
  });
