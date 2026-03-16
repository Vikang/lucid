/**
 * CLI action wrapper — catches errors and prints friendly messages.
 *
 * Wrap every Commander .action() handler with this so users never
 * see raw stack traces. LucidError subclasses get clean output;
 * known API error patterns get helpful hints; everything else
 * falls through to a generic "Unexpected error" message.
 */

import chalk from 'chalk';
import { LucidError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Commander.js action handlers use `any` for variadic args
export function wrapAction<T extends (...args: never[]) => Promise<void>>(fn: T): (...args: Parameters<T>) => Promise<void> {
  return async (...args: Parameters<T>): Promise<void> => {
    try {
      await fn(...args);
    } catch (error) {
      if (error instanceof LucidError) {
        console.error(chalk.red('Error:'), error.message);
        if (error.code) {
          console.error(chalk.dim(`Code: ${error.code}`));
        }
      } else if (error instanceof Error && error.message.includes('quota')) {
        console.error(
          chalk.red('API quota exceeded.'),
          'Check your plan at https://platform.openai.com/billing',
        );
      } else if (error instanceof Error && error.message.includes('401')) {
        console.error(
          chalk.red('Invalid API key.'),
          'Check your environment variables.',
        );
      } else {
        console.error(
          chalk.red('Unexpected error:'),
          error instanceof Error ? error.message : String(error),
        );
      }
      process.exit(1);
    }
  };
}
