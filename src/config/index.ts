/**
 * Configuration loader and saver for Lucid.
 * Reads from ~/.lucid/config.json with sensible defaults.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Config } from '../storage/schema';
import { logger } from '../utils/logger';

const DEFAULT_CONFIG: Config = {
  dataDir: '~/.lucid',
  embedding: {
    provider: 'openai',
    model: 'text-embedding-3-small',
  },
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
  },
  version: '0.1.0',
};

/**
 * Resolve the data directory path, expanding ~ to home.
 */
export function resolveDataDir(dataDir: string): string {
  if (dataDir.startsWith('~')) {
    return join(homedir(), dataDir.slice(1));
  }
  return dataDir;
}

/**
 * Get the path to the config file.
 */
export function getConfigPath(): string {
  return join(resolveDataDir(DEFAULT_CONFIG.dataDir), 'config.json');
}

/**
 * Load configuration from disk.
 * Returns defaults if config file doesn't exist.
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    logger.debug('No config file found, using defaults');
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const loaded = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...loaded };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to read config: ${message}. Using defaults.`);
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to disk.
 * Creates the data directory if it doesn't exist.
 */
export function saveConfig(config: Config): void {
  const dataDir = resolveDataDir(config.dataDir);
  mkdirSync(dataDir, { recursive: true });

  const configPath = join(dataDir, 'config.json');
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  logger.debug(`Config saved to ${configPath}`);
}

/**
 * Get the resolved database path.
 */
export function getDbPath(config: Config): string {
  return join(resolveDataDir(config.dataDir), 'memories.db');
}
