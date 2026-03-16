/**
 * CLI program definition — registers all commands.
 */

import { Command } from 'commander';
import { initCommand } from './init';
import { statusCommand } from './status';
import { curateCommand } from './curate';
import { recallCommand } from './recall';
import { listCommand } from './list';
import { forgetCommand } from './forget';
import { configCommand } from './config';
import { addCommand } from './add';
import { sessionCommand } from './session';
import { importCommand } from './import';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('lucid')
    .description('CLI-first unified memory layer for AI agents')
    .version('0.2.0');

  program.addCommand(initCommand);
  program.addCommand(statusCommand);
  program.addCommand(curateCommand);
  program.addCommand(recallCommand);
  program.addCommand(listCommand);
  program.addCommand(forgetCommand);
  program.addCommand(configCommand);
  program.addCommand(addCommand);
  program.addCommand(sessionCommand);
  program.addCommand(importCommand);

  return program;
}
