/**
 * Simple logger — all output goes to stderr.
 * Stdout is reserved for command output only.
 */

import chalk from 'chalk';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
}

export const logger = {
  setLevel(level: LogLevel): void {
    currentLevel = level;
  },

  debug(message: string): void {
    if (shouldLog('debug')) {
      console.error(chalk.gray(`[debug] ${message}`));
    }
  },

  info(message: string): void {
    if (shouldLog('info')) {
      console.error(chalk.blue(`[info] ${message}`));
    }
  },

  warn(message: string): void {
    if (shouldLog('warn')) {
      console.error(chalk.yellow(`[warn] ${message}`));
    }
  },

  error(message: string): void {
    if (shouldLog('error')) {
      console.error(chalk.red(`[error] ${message}`));
    }
  },
};
