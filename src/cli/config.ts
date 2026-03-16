/**
 * `lucid config` — View and modify Lucid configuration.
 *
 * Subcommands:
 *   show             — Print current config as formatted JSON
 *   set <key> <val>  — Set a config value (dot notation: llm.provider, embedding.model)
 *   reset            — Reset config to defaults
 */

import { Command } from 'commander';
import { loadConfig, saveConfig } from '../config';
import { wrapAction } from '../utils/cli-wrapper';
import { ValidationError } from '../utils/errors';
import chalk from 'chalk';

/** Dot-notation keys that users are allowed to set. */
const SETTABLE_KEYS = [
  'llm.provider',
  'llm.model',
  'embedding.provider',
  'embedding.model',
  'dataDir',
] as const;

type SettableKey = typeof SETTABLE_KEYS[number];

function isSettableKey(key: string): key is SettableKey {
  return (SETTABLE_KEYS as readonly string[]).includes(key);
}

/**
 * Set a nested value on a config object using dot notation.
 */
function setNestedValue(obj: Record<string, unknown>, key: string, value: string): void {
  const parts = key.split('.');
  if (parts.length === 1) {
    obj[parts[0]] = value;
    return;
  }
  let current = obj as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

export const configCommand = new Command('config')
  .description('View and modify Lucid configuration');

configCommand
  .command('show')
  .description('Print current config as formatted JSON')
  .action(wrapAction(async () => {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
  }));

configCommand
  .command('set')
  .description('Set a config value (dot notation)')
  .argument('<key>', `Config key (${SETTABLE_KEYS.join(', ')})`)
  .argument('<value>', 'Value to set')
  .action(wrapAction(async (key: string, value: string) => {
    if (!isSettableKey(key)) {
      throw new ValidationError(
        `Unknown config key: "${key}".\nSettable keys: ${SETTABLE_KEYS.join(', ')}`,
      );
    }

    const config = loadConfig();
    setNestedValue(config as unknown as Record<string, unknown>, key, value);
    saveConfig(config);

    console.log(chalk.green('✓'), `Set ${chalk.bold(key)} = ${chalk.cyan(value)}`);
  }));

configCommand
  .command('reset')
  .description('Reset config to defaults')
  .action(wrapAction(async () => {
    const config = loadConfig();
    // Reset to defaults but keep dataDir so we write to the right place
    const defaultConfig = {
      dataDir: config.dataDir,
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
      version: '0.1.0',
    };
    saveConfig(defaultConfig);
    console.log(chalk.green('✓'), 'Config reset to defaults.');
    console.log(JSON.stringify(defaultConfig, null, 2));
  }));
