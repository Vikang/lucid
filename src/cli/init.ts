/**
 * `lucid init` — Initialize the Lucid data directory.
 *
 * Creates ~/.lucid/, config.json, and an empty SQLite database.
 */

import { Command } from 'commander';
import { existsSync, mkdirSync } from 'node:fs';
import { loadConfig, saveConfig, resolveDataDir, getDbPath } from '../config';
import { initDatabase, closeDatabase } from '../storage/db';
import { logger } from '../utils/logger';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const initCommand = new Command('init')
  .description('Initialize Lucid data directory and database')
  .action(wrapAction(async () => {
    const config = loadConfig();
    const dataDir = resolveDataDir(config.dataDir);

    // Create data directory
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      logger.info(`Created data directory: ${dataDir}`);
    } else {
      logger.info(`Data directory already exists: ${dataDir}`);
    }

    // Create subdirectories
    const subdirs = ['episodes', 'vectors'];
    for (const sub of subdirs) {
      const subPath = `${dataDir}/${sub}`;
      if (!existsSync(subPath)) {
        mkdirSync(subPath, { recursive: true });
      }
    }

    // Save config
    saveConfig(config);

    // Initialize database
    const dbPath = getDbPath(config);
    initDatabase(dbPath);
    closeDatabase();

    console.log(chalk.green('✓') + ' Lucid initialized at ' + dataDir + '/');

    if (config.embedding.provider === 'local') {
      console.log(chalk.blue('ℹ') + ' Local embedding model will download on first use (~80MB)');
      console.log(chalk.blue('ℹ') + ' No API keys needed! Run \'lucid add\' to store memories, \'lucid recall\' to search.');
    } else {
      console.log(`  Embedding: ${config.embedding.provider} (${config.embedding.model})`);
      console.log(`  LLM: ${config.llm.provider} (${config.llm.model})`);
    }
  }));
