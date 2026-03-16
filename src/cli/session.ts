/**
 * `lucid session` — Episode management commands.
 *
 * Subcommands: save, search, list, primer, show
 */

import { Command } from 'commander';
import { saveEpisode, getEpisode, listEpisodes, searchEpisodes, generatePrimer } from '../core/episodes';
import { loadConfig } from '../config';
import { readTranscript } from '../utils/transcript';
import { wrapAction } from '../utils/cli-wrapper';
import { ValidationError } from '../utils/errors';
import chalk from 'chalk';

// ─── session save ────────────────────────────────────────────────────

const saveCommand = new Command('save')
  .description('Save a conversation transcript as an episode')
  .option('--file <path>', 'Read transcript from file')
  .option('--text <string>', 'Pass transcript text directly')
  .option('--label <label>', 'Session label')
  .option('--summary <text>', 'Brief summary')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('--project <id>', 'Project association')
  .option('--tone <tone>', 'Interaction tone')
  .option('--duration <duration>', 'Session duration')
  .option('--link <memoryIds>', 'Comma-separated memory IDs to link')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (opts: {
    file?: string;
    text?: string;
    label?: string;
    summary?: string;
    tags?: string;
    project?: string;
    tone?: string;
    duration?: string;
    link?: string;
    json?: boolean;
  }) => {
    const config = loadConfig();

    // Read transcript from file, text, or stdin
    const transcript = await readTranscript({ file: opts.file, text: opts.text });

    if (!transcript.trim()) {
      throw new ValidationError('Transcript cannot be empty.');
    }

    // Parse tags
    const tags = opts.tags
      ? opts.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];

    // Parse memory IDs to link
    const memoryIds = opts.link
      ? opts.link.split(',').map((id) => id.trim()).filter(Boolean)
      : [];

    const episode = await saveEpisode({
      transcript,
      label: opts.label,
      summary: opts.summary,
      tags,
      projectId: opts.project,
      interactionTone: opts.tone,
      duration: opts.duration,
      memoryIds: memoryIds.length > 0 ? memoryIds : undefined,
    }, config);

    if (opts.json) {
      console.log(JSON.stringify(episode, null, 2));
    } else {
      console.log(chalk.green('✓') + ' Episode saved');
      console.log(`  ${chalk.dim('id:')} ${episode.id}`);
      if (episode.label) {
        console.log(`  ${chalk.dim('label:')} ${episode.label}`);
      }
      console.log(`  ${chalk.dim('messages:')} ${episode.messageCount}`);
      if (tags.length > 0) {
        console.log(`  ${chalk.dim('tags:')} ${tags.join(', ')}`);
      }
      if (episode.summary !== episode.transcript) {
        console.log(`  ${chalk.dim('summary:')} ${episode.summary.slice(0, 100)}${episode.summary.length > 100 ? '...' : ''}`);
      }
    }
  }));

// ─── session search ──────────────────────────────────────────────────

const searchCommand = new Command('search')
  .description('Search past sessions semantically')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (query: string, opts: { limit: string; json?: boolean }) => {
    const config = loadConfig();
    const limit = parseInt(opts.limit, 10);

    const results = await searchEpisodes(query, config, { limit });

    if (results.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.yellow('No sessions found matching your query.'));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(chalk.bold(`Found ${results.length} sessions:\n`));
      for (const r of results) {
        const scoreColor = r.score >= 0.7 ? chalk.green : r.score >= 0.5 ? chalk.yellow : chalk.dim;
        const dateStr = new Date(r.createdAt).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        });
        console.log(`  ${scoreColor(`[${r.score.toFixed(2)}]`)} ${r.label || 'Untitled'} (${dateStr})`);

        const meta = [];
        if (r.messageCount > 0) meta.push(`${r.messageCount} messages`);
        if (r.duration) meta.push(r.duration);
        if (r.tags.length > 0) meta.push(`Tags: ${r.tags.join(', ')}`);
        if (meta.length > 0) {
          console.log(`  ${chalk.cyan('→')} ${meta.join(' | ')}`);
        }

        if (r.summary) {
          const summaryPreview = r.summary.slice(0, 120) + (r.summary.length > 120 ? '...' : '');
          console.log(`  ${chalk.dim(`Summary: ${summaryPreview}`)}`);
        }
        console.log();
      }
    }
  }));

// ─── session list ────────────────────────────────────────────────────

const listCommand = new Command('list')
  .description('List past sessions')
  .option('-n, --limit <n>', 'Max results', '10')
  .option('--project <id>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (opts: { limit: string; project?: string; json?: boolean }) => {
    const config = loadConfig();
    const limit = parseInt(opts.limit, 10);

    const episodes = await listEpisodes(config, { limit, projectId: opts.project });

    if (episodes.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.yellow('No sessions recorded yet.'));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(episodes, null, 2));
    } else {
      console.log(chalk.bold(`${episodes.length} sessions:\n`));
      for (const ep of episodes) {
        const dateStr = new Date(ep.createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });
        console.log(`  ${chalk.dim(`[${dateStr}]`)} ${ep.label || 'Untitled'}`);

        const meta = [];
        if (ep.messageCount > 0) meta.push(`${ep.messageCount} messages`);
        if (ep.duration) meta.push(ep.duration);
        if (ep.tags.length > 0) meta.push(`Tags: ${ep.tags.join(', ')}`);
        if (meta.length > 0) {
          console.log(`  ${meta.join(' | ')}`);
        }
        console.log();
      }
    }
  }));

// ─── session primer ──────────────────────────────────────────────────

const primerCommand = new Command('primer')
  .description('Generate a context primer from the most recent session')
  .option('--project <id>', 'Filter by project')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (opts: { project?: string; json?: boolean }) => {
    const config = loadConfig();

    const primer = await generatePrimer(config, { projectId: opts.project });

    if (opts.json) {
      console.log(JSON.stringify({ primer }, null, 2));
    } else {
      console.log(primer);
    }
  }));

// ─── session show ────────────────────────────────────────────────────

const showCommand = new Command('show')
  .description('Show full episode details')
  .argument('<id>', 'Episode ID')
  .option('--json', 'Output as JSON')
  .action(wrapAction(async (id: string, opts: { json?: boolean }) => {
    const config = loadConfig();

    const episode = await getEpisode(id, config);

    if (!episode) {
      console.log(chalk.yellow(`Episode not found: ${id}`));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(episode, null, 2));
    } else {
      const dateStr = new Date(episode.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
      });

      console.log(chalk.bold(episode.label || 'Untitled Session'));
      console.log('─'.repeat(40));
      console.log(`  ${chalk.dim('ID:')} ${episode.id}`);
      console.log(`  ${chalk.dim('Date:')} ${dateStr}`);
      if (episode.duration) {
        console.log(`  ${chalk.dim('Duration:')} ${episode.duration}`);
      }
      console.log(`  ${chalk.dim('Messages:')} ${episode.messageCount}`);
      if (episode.tags.length > 0) {
        console.log(`  ${chalk.dim('Tags:')} ${episode.tags.join(', ')}`);
      }
      if (episode.projectId) {
        console.log(`  ${chalk.dim('Project:')} ${episode.projectId}`);
      }
      if (episode.interactionTone) {
        console.log(`  ${chalk.dim('Tone:')} ${episode.interactionTone}`);
      }

      console.log();
      console.log(chalk.bold('Summary:'));
      console.log(`  ${episode.summary}`);

      console.log();
      console.log(chalk.bold('Transcript:'));
      // Show first 1000 chars of transcript
      const preview = episode.transcript.slice(0, 1000);
      console.log(preview);
      if (episode.transcript.length > 1000) {
        console.log(chalk.dim(`\n... (${episode.transcript.length - 1000} more characters)`));
      }
    }
  }));

// ─── session command group ───────────────────────────────────────────

export const sessionCommand = new Command('session')
  .description('Manage conversation episodes')
  .addCommand(saveCommand)
  .addCommand(searchCommand)
  .addCommand(listCommand)
  .addCommand(primerCommand)
  .addCommand(showCommand);
