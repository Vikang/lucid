/**
 * `lucid curate` — Extract memories from a conversation transcript.
 */

import { Command } from 'commander';
import { readTranscript } from '../utils/transcript';
import { curateTranscript } from '../core/curator';
import { addMemory } from '../core/memory';
import { loadConfig } from '../config';
import { logger } from '../utils/logger';
import { wrapAction } from '../utils/cli-wrapper';
import { ValidationError } from '../utils/errors';
import chalk from 'chalk';

export const curateCommand = new Command('curate')
  .description('Extract memories from a conversation transcript')
  .option('-f, --file <path>', 'Read transcript from a file')
  .option('-t, --text <string>', 'Pass transcript text directly')
  .option('--json', 'Output as JSON')
  .option('--dry-run', 'Extract memories but don\'t save them')
  .action(wrapAction(async (opts: { file?: string; text?: string; json?: boolean; dryRun?: boolean }) => {
    const config = loadConfig();

    // Check if LLM is configured
    if (config.llm.provider === 'none') {
      console.log(chalk.yellow('lucid curate is an optional feature that requires an LLM provider.\n'));
      console.log('To use it, configure one of these options:');
      console.log(`  ${chalk.cyan('lucid config set llm.provider ollama')}    # Local (free, needs Ollama installed)`);
      console.log(`  ${chalk.cyan('lucid config set llm.provider anthropic')} # API (needs ANTHROPIC_API_KEY)`);
      console.log(`  ${chalk.cyan('lucid config set llm.provider openai')}    # API (needs OPENAI_API_KEY)`);
      console.log(`  ${chalk.cyan('lucid config set llm.provider gemini')}    # API (needs GEMINI_API_KEY)`);
      console.log(`\nTip: You don't need curate! Your AI agent can extract memories and use ${chalk.bold('lucid add')} directly.`);
      return;
    }

    // Read transcript from file, text, or stdin
    const transcript = await readTranscript({
      file: opts.file,
      text: opts.text,
    });

    if (!transcript.trim()) {
      throw new ValidationError('Transcript is empty. Provide a non-empty transcript to curate.');
    }

    logger.info(`Read transcript (${transcript.length} chars)`);

    // Extract memories via LLM
    const memories = await curateTranscript(transcript, config);

    if (memories.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.yellow('No memories extracted from this transcript.'));
      }
      return;
    }

    if (opts.dryRun) {
      if (opts.json) {
        console.log(JSON.stringify(memories, null, 2));
      } else {
        console.log(chalk.cyan(`[dry-run] Would extract ${memories.length} memories:\n`));
        for (const m of memories) {
          console.log(`  ${chalk.bold(m.content)}`);
          console.log(`  importance: ${m.importance ?? 0.5} | tags: ${(m.tags ?? []).join(', ') || 'none'}`);
          console.log();
        }
      }
      return;
    }

    // Save each extracted memory
    const saved = [];
    for (const input of memories) {
      const memory = await addMemory(input, config);
      saved.push(memory);
    }

    if (opts.json) {
      console.log(JSON.stringify(saved, null, 2));
    } else {
      console.log(chalk.green(`✓ Extracted ${saved.length} memories\n`));
      for (const m of saved) {
        console.log(`  ${chalk.bold(m.content)}`);
        console.log(`  ${chalk.dim(`id: ${m.id} | importance: ${m.importance} | tags: ${m.tags.join(', ') || 'none'}`)}`);
        console.log();
      }
    }
  }));
