/**
 * `lucid status` — Report current Lucid configuration and stats.
 */

import { Command } from 'commander';
import { existsSync, statSync } from 'node:fs';
import { loadConfig, resolveDataDir, getConfigPath, getDbPath } from '../config';
import { initDatabase, getMemoryCount, closeDatabase } from '../storage/db';
import chalk from 'chalk';

export const statusCommand = new Command('status')
  .description('Show Lucid status and configuration')
  .action(() => {
    const config = loadConfig();
    const dataDir = resolveDataDir(config.dataDir);
    const configPath = getConfigPath();
    const dbPath = getDbPath(config);
    const initialized = existsSync(configPath);

    console.log(chalk.bold('Lucid Status'));
    console.log('─'.repeat(40));
    console.log(`  Initialized:  ${initialized ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`  Config:       ${configPath}`);
    console.log(`  Data dir:     ${dataDir}`);
    console.log(`  Version:      ${config.version}`);

    if (existsSync(dbPath)) {
      const dbStat = statSync(dbPath);
      const sizeKb = (dbStat.size / 1024).toFixed(1);

      const db = initDatabase(dbPath);
      const count = getMemoryCount(db);
      closeDatabase();

      console.log(`  Database:     ${dbPath} (${sizeKb} KB)`);
      console.log(`  Memories:     ${count}`);
    } else {
      console.log(`  Database:     ${chalk.dim('not created yet')}`);
      console.log(`  Memories:     ${chalk.dim('—')}`);
    }

    console.log(`  Embedding:    ${config.embedding.provider} (${config.embedding.model})`);
    console.log(`  LLM:          ${config.llm.provider} (${config.llm.model})`);
  });
