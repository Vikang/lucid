/**
 * `lucid forget` — Delete a memory by ID.
 */

import { Command } from 'commander';
import { deleteMemory, getMemory } from '../core/memory';
import { loadConfig } from '../config';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const forgetCommand = new Command('forget')
  .description('Delete a memory by ID')
  .argument('<id>', 'Memory ID to delete')
  .action(wrapAction(async (id: string) => {
    const config = loadConfig();

    // Check if memory exists first
    const memory = await getMemory(id, config);
    if (!memory) {
      console.error(chalk.red(`Memory not found: ${id}`));
      console.error(chalk.dim('Use `lucid list` to see stored memories.'));
      process.exit(1);
    }

    const deleted = await deleteMemory(id, config);
    if (deleted) {
      console.log(chalk.green(`✓ Deleted memory ${id}`));
      console.log(chalk.dim(`  "${memory.content.slice(0, 80)}${memory.content.length > 80 ? '…' : ''}"`));
    } else {
      console.error(chalk.red(`Failed to delete memory ${id}`));
      process.exit(1);
    }
  }));
