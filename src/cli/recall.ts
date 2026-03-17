/**
 * `lucid recall` — Search memories semantically with smart scoring.
 */

import { Command } from 'commander';
import { searchMemories } from '../core/search';
import { getEpisode } from '../core/episodes';
import { loadConfig } from '../config';
import { logger } from '../utils/logger';
import { wrapAction } from '../utils/cli-wrapper';
import chalk from 'chalk';

export const recallCommand = new Command('recall')
  .description('Search memories semantically')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('--json', 'Output as JSON')
  .option('--min-score <threshold>', 'Minimum similarity score', '0.0')
  .action(wrapAction(async (query: string, opts: { limit: string; json?: boolean; minScore: string }) => {
    const config = loadConfig();
    const limit = parseInt(opts.limit, 10);
    const minScore = parseFloat(opts.minScore);

    logger.debug(`Searching for: ${query}`);

    const results = await searchMemories(query, {
      limit,
      minScore,
      config,
    });

    if (results.length === 0) {
      if (opts.json) {
        console.log(JSON.stringify([], null, 2));
      } else {
        console.log(chalk.yellow('No memories found matching your query.'));
      }
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      console.log(chalk.bold(`Found ${results.length} memories:\n`));
      for (const r of results) {
        const scoreColor = r.score >= 0.8 ? chalk.green : r.score >= 0.5 ? chalk.yellow : chalk.dim;
        const agentSuffix = r.sourceAgent ? chalk.magenta(` (via ${r.sourceAgent})`) : '';
        console.log(`  ${scoreColor(`[${r.score.toFixed(2)}]`)} ${r.content}${agentSuffix}`);
        console.log(`  ${chalk.cyan('→')} ${r.reasoning}`);

        // Show episode source if linked
        if (r.episodeId) {
          const episode = await getEpisode(r.episodeId, config);
          if (episode) {
            const dateStr = new Date(episode.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            });
            console.log(`  ${chalk.cyan('→')} From session: "${episode.label || 'Untitled'}" (${dateStr})`);
          }
        }

        console.log(`  ${chalk.dim(`tags: ${r.tags.join(', ') || 'none'} | importance: ${r.importance} | ${r.contextType}`)}`);
        console.log();
      }
    }
  }));
