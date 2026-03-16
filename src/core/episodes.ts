/**
 * Episode storage and retrieval — conversation transcripts with metadata.
 *
 * Episodes represent full conversation sessions. Memories can link back
 * to their source episode via episode_id.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { initDatabase, closeDatabase } from '../storage/db';
import { getDbPath } from '../config';
import { embed } from './embedder';
import { cosineSimilarity } from './search';
import type { Episode, Config } from '../storage/schema';

// ─── Types ───────────────────────────────────────────────────────────

export interface SaveEpisodeInput {
  transcript: string;
  label?: string;
  summary?: string;
  tags?: string[];
  projectId?: string;
  interactionTone?: string;
  duration?: string;
  memoryIds?: string[];
}

export interface EpisodeSearchResult extends Episode {
  score: number;
  matchType: 'semantic' | 'text';
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface EpisodeRow {
  id: string;
  label: string;
  summary: string;
  transcript: string;
  message_count: number;
  project_id: string;
  interaction_tone: string;
  duration: string;
  embedding: string | null;
  embedding_dim: number | null;
  created_at: string;
}

/**
 * Convert a database row + tags into an Episode object.
 */
function rowToEpisode(row: EpisodeRow, tags: string[]): Episode {
  return {
    id: row.id,
    label: row.label,
    summary: row.summary,
    transcript: row.transcript,
    messageCount: row.message_count,
    tags,
    projectId: row.project_id,
    interactionTone: row.interaction_tone,
    createdAt: row.created_at,
    duration: row.duration,
    embeddingDim: row.embedding_dim,
  };
}

/**
 * Count messages in a transcript (lines starting with Human:/User:/Assistant:).
 */
function countMessages(transcript: string): number {
  const pattern = /^(Human|User|Assistant|System):/gm;
  const matches = transcript.match(pattern);
  return matches ? matches.length : 0;
}

/**
 * Format a time difference as a human-readable "time ago" string.
 */
export function formatTimeAgo(date: Date, now?: Date): string {
  const reference = now ?? new Date();
  const diffMs = reference.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return `${diffWeeks} week${diffWeeks === 1 ? '' : 's'} ago`;
}

// ─── Core Functions ──────────────────────────────────────────────────

/**
 * Save a conversation transcript as an episode.
 */
export async function saveEpisode(input: SaveEpisodeInput, config: Config): Promise<Episode> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Use summary or first 500 chars of transcript
    const summary = input.summary || input.transcript.slice(0, 500);

    // Count messages
    const messageCount = countMessages(input.transcript);

    // Generate embedding of summary (not full transcript)
    let embeddingJson: string | null = null;
    let embeddingDim: number | null = null;
    try {
      const vector = await embed(summary, config);
      embeddingJson = JSON.stringify(vector);
      embeddingDim = vector.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to generate episode embedding: ${message}. Episode saved without embedding.`);
    }

    // Insert episode row
    db.run(
      `INSERT INTO episodes (id, label, summary, transcript, message_count, project_id, interaction_tone, duration, embedding, embedding_dim, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.label ?? '',
        summary,
        input.transcript,
        messageCount,
        input.projectId ?? '',
        input.interactionTone ?? '',
        input.duration ?? '',
        embeddingJson,
        embeddingDim,
        now,
      ],
    );

    // Insert tags
    const tags = input.tags ?? [];
    for (const tag of tags) {
      db.run('INSERT OR IGNORE INTO episode_tags (episode_id, tag) VALUES (?, ?)', [id, tag]);
    }

    // Link existing memories if provided
    if (input.memoryIds && input.memoryIds.length > 0) {
      for (const memoryId of input.memoryIds) {
        db.run('UPDATE memories SET episode_id = ? WHERE id = ?', [id, memoryId]);
      }
    }

    logger.debug(`Saved episode ${id} with ${tags.length} tags`);

    return {
      id,
      label: input.label ?? '',
      summary,
      transcript: input.transcript,
      messageCount,
      tags,
      projectId: input.projectId ?? '',
      interactionTone: input.interactionTone ?? '',
      createdAt: now,
      duration: input.duration ?? '',
      embeddingDim,
    };
  } finally {
    closeDatabase();
  }
}

/**
 * Get an episode by its ID, with tags joined.
 */
export async function getEpisode(id: string, config: Config): Promise<Episode | null> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    const row = db.query('SELECT * FROM episodes WHERE id = ?').get(id) as EpisodeRow | null;
    if (!row) return null;

    const tagRows = db.query('SELECT tag FROM episode_tags WHERE episode_id = ?').all(id) as { tag: string }[];
    const tags = tagRows.map((r) => r.tag);

    return rowToEpisode(row, tags);
  } finally {
    closeDatabase();
  }
}

/**
 * List episodes sorted by created_at desc.
 */
export async function listEpisodes(
  config: Config,
  options?: { limit?: number; projectId?: string },
): Promise<Episode[]> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);
  const limit = options?.limit ?? 10;

  try {
    let rows: EpisodeRow[];

    if (options?.projectId) {
      rows = db.query(
        'SELECT * FROM episodes WHERE project_id = ? ORDER BY created_at DESC LIMIT ?',
      ).all(options.projectId, limit) as EpisodeRow[];
    } else {
      rows = db.query(
        'SELECT * FROM episodes ORDER BY created_at DESC LIMIT ?',
      ).all(limit) as EpisodeRow[];
    }

    return rows.map((row) => {
      const tagRows = db.query('SELECT tag FROM episode_tags WHERE episode_id = ?').all(row.id) as { tag: string }[];
      const tags = tagRows.map((r) => r.tag);
      return rowToEpisode(row, tags);
    });
  } finally {
    closeDatabase();
  }
}

/**
 * Delete an episode by its ID. Tags cascade via foreign key.
 */
export async function deleteEpisode(id: string, config: Config): Promise<boolean> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Clear episode_id on linked memories
    db.run('UPDATE memories SET episode_id = NULL WHERE episode_id = ?', [id]);
    // Delete tags first (in case FK cascade isn't working)
    db.run('DELETE FROM episode_tags WHERE episode_id = ?', [id]);
    const result = db.run('DELETE FROM episodes WHERE id = ?', [id]);
    const deleted = result.changes > 0;

    if (deleted) {
      logger.debug(`Deleted episode ${id}`);
    } else {
      logger.debug(`Episode ${id} not found`);
    }

    return deleted;
  } finally {
    closeDatabase();
  }
}

/**
 * Search episodes by semantic similarity + text fallback.
 */
export async function searchEpisodes(
  query: string,
  config: Config,
  options?: { limit?: number },
): Promise<EpisodeSearchResult[]> {
  const limit = options?.limit ?? 5;
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Generate query embedding
    const queryEmbedding = await embed(query, config);
    const queryDim = queryEmbedding.length;

    // Load episodes with embeddings
    const rows = db.query(
      'SELECT * FROM episodes WHERE embedding IS NOT NULL AND (embedding_dim = ? OR embedding_dim IS NULL)',
    ).all(queryDim) as (EpisodeRow & { embedding: string })[];

    const results: EpisodeSearchResult[] = [];

    // Semantic search
    for (const row of rows) {
      if (!row.embedding) continue;

      let episodeEmbedding: number[];
      try {
        episodeEmbedding = JSON.parse(row.embedding) as number[];
      } catch {
        logger.warn(`Invalid embedding for episode ${row.id}, skipping`);
        continue;
      }

      if (episodeEmbedding.length !== queryDim) continue;

      const score = cosineSimilarity(queryEmbedding, episodeEmbedding);

      if (score > 0.3) {
        const tagRows = db.query('SELECT tag FROM episode_tags WHERE episode_id = ?').all(row.id) as { tag: string }[];
        const tags = tagRows.map((r) => r.tag);

        results.push({
          ...rowToEpisode(row, tags),
          score,
          matchType: 'semantic',
        });
      }
    }

    // Text search fallback — find episodes where transcript contains query terms
    const queryLower = query.toLowerCase();
    const allRows = db.query('SELECT * FROM episodes').all() as EpisodeRow[];

    for (const row of allRows) {
      // Skip if already found via semantic search
      if (results.some((r) => r.id === row.id)) continue;

      const transcriptLower = row.transcript.toLowerCase();
      const summaryLower = row.summary.toLowerCase();
      const labelLower = row.label.toLowerCase();

      if (transcriptLower.includes(queryLower) || summaryLower.includes(queryLower) || labelLower.includes(queryLower)) {
        const tagRows = db.query('SELECT tag FROM episode_tags WHERE episode_id = ?').all(row.id) as { tag: string }[];
        const tags = tagRows.map((r) => r.tag);

        results.push({
          ...rowToEpisode(row, tags),
          score: 0.5, // Fixed score for text matches
          matchType: 'text',
        });
      }
    }

    // Sort by score and limit
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  } finally {
    closeDatabase();
  }
}

/**
 * Generate a session primer — a context block about the most recent session.
 */
export async function generatePrimer(
  config: Config,
  options?: { projectId?: string },
): Promise<string> {
  const episodes = await listEpisodes(config, { limit: 1, projectId: options?.projectId });

  if (episodes.length === 0) {
    return 'No previous sessions recorded.';
  }

  const episode = episodes[0];
  const timeAgo = formatTimeAgo(new Date(episode.createdAt));
  const dateStr = new Date(episode.createdAt).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const lines = [
    '# Continuing Session',
    `*Last session: ${timeAgo} (${dateStr})*`,
    '',
    `**Previous session**: ${episode.summary}`,
    `**Topics**: ${episode.tags.length > 0 ? episode.tags.join(', ') : 'none'}`,
  ];

  if (episode.duration) {
    lines.push(`**Duration**: ${episode.duration}`);
  }

  lines.push('');
  lines.push('Memories from that session will surface as relevant.');

  return lines.join('\n');
}
