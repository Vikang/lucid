/**
 * `lucid add` — Manually add a memory with content, tags, and importance.
 *
 * No LLM needed — the calling agent (or user) provides the content directly.
 */

import { Command } from 'commander';
import { addMemory } from '../core/memory';
import { findDuplicates } from '../core/dedup';
import { loadConfig } from '../config';
import { wrapAction } from '../utils/cli-wrapper';
import { ValidationError } from '../utils/errors';
import chalk from 'chalk';

export const addCommand = new Command('add')
  .description('Add a memory manually')
  .argument('<content>', 'Memory content text')
  .option('-t, --tags <tags>', 'Comma-separated tags')
  .option('-i, --importance <score>', 'Importance 0.0-1.0', '0.5')
  .option('--type <contextType>', 'Context type', 'PROJECT_CONTEXT')
  .option('--source <session>', 'Source session identifier')
  .option('--triggers <phrases>', 'Comma-separated trigger phrases')
  .option('--questions <types>', 'Comma-separated question types')
  .option('--emotion <type>', 'Emotional resonance: joy|frustration|discovery|gratitude')
  .option('--problem-solution', 'Mark as problem-solution pair')
  .option('--confidence <score>', 'Confidence 0.0-1.0', '0.8')
  .option('--action-required', 'Mark as requiring action')
  .option('--domain <domain>', 'Knowledge domain')
  .option('--episode <id>', 'Link to an episode')
  .option('--agent <name>', 'Source agent name')
  .option('--no-dedup', 'Skip deduplication check')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (
    content: string,
    opts: {
      tags?: string;
      importance: string;
      type: string;
      source?: string;
      triggers?: string;
      questions?: string;
      emotion?: string;
      problemSolution?: boolean;
      confidence: string;
      actionRequired?: boolean;
      domain?: string;
      episode?: string;
      agent?: string;
      dedup?: boolean;
      json?: boolean;
    },
  ) => {
    const config = loadConfig();
    const skipDedup = opts.dedup === false;

    // Validate content
    if (!content.trim()) {
      throw new ValidationError('Memory content cannot be empty.');
    }

    // Parse importance
    const importance = parseFloat(opts.importance);
    if (isNaN(importance) || importance < 0 || importance > 1) {
      throw new ValidationError(
        `Invalid importance value: "${opts.importance}". Must be a number between 0.0 and 1.0.`,
      );
    }

    // Parse confidence
    const confidence = parseFloat(opts.confidence);
    if (isNaN(confidence) || confidence < 0 || confidence > 1) {
      throw new ValidationError(
        `Invalid confidence value: "${opts.confidence}". Must be a number between 0.0 and 1.0.`,
      );
    }

    // Parse tags
    const tags = opts.tags
      ? opts.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    // Parse trigger phrases
    const triggerPhrases = opts.triggers
      ? opts.triggers.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // Parse question types
    const questionTypes = opts.questions
      ? opts.questions.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    // Dedup check: warn on near-matches, skip on exact hash match
    let wasExactDuplicate = false;
    if (!skipDedup) {
      try {
        const duplicates = await findDuplicates(content.trim(), config);
        if (duplicates.length > 0) {
          const best = duplicates[0];
          if (best.similarity === 1.0) {
            // Exact duplicate — skip
            if (opts.json) {
              console.log(JSON.stringify(best.memory, null, 2));
            } else {
              console.log(chalk.yellow('⚠️  Exact duplicate exists — skipping'));
              console.log(`  ${chalk.dim('id:')} ${best.memory.id}`);
              const preview = best.memory.content.length > 80
                ? best.memory.content.slice(0, 80) + '...'
                : best.memory.content;
              console.log(`  ${chalk.dim('content:')} ${preview}`);
            }
            wasExactDuplicate = true;
          } else {
            const preview = best.memory.content.length > 60
              ? best.memory.content.slice(0, 60) + '...'
              : best.memory.content;
            console.log(
              chalk.yellow('⚠️  Similar memory exists: ') + preview +
              chalk.dim(` (${(best.similarity * 100).toFixed(1)}% match)`),
            );
            console.log(chalk.dim("   Adding anyway. Run 'lucid dedup' to clean up."));
          }
        }
      } catch {
        // Dedup check failed — continue with add
      }
    }

    if (wasExactDuplicate) return;

    const memory = await addMemory({
      content: content.trim(),
      importance,
      tags,
      contextType: opts.type,
      triggerPhrases: triggerPhrases.length > 0 ? triggerPhrases : undefined,
      sourceSession: opts.source,
      temporalRelevance: 'persistent',
      questionTypes: questionTypes.length > 0 ? questionTypes : undefined,
      emotionalResonance: opts.emotion,
      problemSolutionPair: opts.problemSolution,
      confidenceScore: confidence,
      actionRequired: opts.actionRequired,
      knowledgeDomain: opts.domain,
      episodeId: opts.episode,
      sourceAgent: opts.agent,
    }, config, { skipDedup: true });

    if (opts.json) {
      console.log(JSON.stringify(memory, null, 2));
    } else {
      const agentSuffix = memory.sourceAgent ? ` (agent: ${memory.sourceAgent})` : '';
      console.log(chalk.green('✓') + ` Memory added${agentSuffix}`);
      console.log(`  ${chalk.dim('id:')} ${memory.id}`);
      console.log(`  ${chalk.dim('content:')} ${memory.content}`);
      if (tags.length > 0) {
        console.log(`  ${chalk.dim('tags:')} ${tags.join(', ')}`);
      }
      console.log(`  ${chalk.dim('importance:')} ${memory.importance}`);
      if (triggerPhrases.length > 0) {
        console.log(`  ${chalk.dim('triggers:')} ${triggerPhrases.join(', ')}`);
      }
      if (opts.domain) {
        console.log(`  ${chalk.dim('domain:')} ${opts.domain}`);
      }
    }
  }));
