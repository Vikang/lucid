/**
 * CLI program definition — registers all commands.
 */

import { Command } from 'commander';
import { initCommand } from './init';
import { statusCommand } from './status';
import { curateCommand } from './curate';
import { recallCommand } from './recall';
import { listCommand } from './list';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('lucid')
    .description('CLI-first unified memory layer for AI agents')
    .version('0.1.0');

  program.addCommand(initCommand);
  program.addCommand(statusCommand);
  program.addCommand(curateCommand);
  program.addCommand(recallCommand);
  program.addCommand(listCommand);

  return program;
}
