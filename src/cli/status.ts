/**
 * `lucid status` — Report current Lucid configuration and stats.
 */

import { Command } from 'commander';
import { existsSync, statSync } from 'node:fs';
import { loadConfig, resolveDataDir, getConfigPath, getDbPath } from '../config';
import { initDatabase, getMemoryCount, getEpisodeCount, getEmbeddingDimStats, closeDatabase } from '../storage/db';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const statusCommand = new Command('status')
  .description('Show Lucid status and configuration')
  .action(wrapAction(async () => {
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
      const episodeCount = getEpisodeCount(db);
      const dimStats = getEmbeddingDimStats(db);
      closeDatabase();

      console.log(`  Database:     ${dbPath} (${sizeKb} KB)`);
      console.log(`  Memories:     ${count}`);
      console.log(`  Episodes:     ${episodeCount}`);

      // Show dimension stats
      if (dimStats.length > 0) {
        const dims = dimStats.map((s) => `${s.dim ?? 'unknown'}d (${s.count})`).join(', ');
        console.log(`  Embeddings:   ${dims}`);

        // Warn about mixed dimensions
        const distinctDims = dimStats.filter((s) => s.dim !== null).map((s) => s.dim);
        if (distinctDims.length > 1) {
          console.log(chalk.yellow('  ⚠ Mixed embedding dimensions detected!'));
          console.log(chalk.yellow('    Memories with different dimensions cannot be compared.'));
          console.log(chalk.yellow('    Consider re-embedding with a single provider.'));
        }
      }
    } else {
      console.log(`  Database:     ${chalk.dim('not created yet')}`);
      console.log(`  Memories:     ${chalk.dim('—')}`);
    }

    console.log(`  Embedding:    ${config.embedding.provider} (${config.embedding.model || 'default'})`);

    if (config.llm.provider === 'none') {
      console.log(`  LLM:          ${chalk.dim('none (curate disabled — use \'lucid add\' instead)')}`);
    } else {
      console.log(`  LLM:          ${config.llm.provider} (${config.llm.model || 'default'})`);
    }
  }));
