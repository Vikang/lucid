/**
 * Semantic search over memories using cosine similarity.
 *
 * Brute-force approach — fine for v0.1 with <10k memories.
 * Vectra optimization planned for v0.2.
 */

import { logger } from '../utils/logger';
import { embed } from './embedder';
import { initDatabase, closeDatabase } from '../storage/db';
import { getDbPath } from '../config';
import { ContextType } from '../storage/schema';
import type { Config, Memory } from '../storage/schema';

export interface SearchResult extends Memory {
  score: number;
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  config: Config;
}

interface MemoryWithEmbedding {
  id: string;
  content: string;
  importance: number;
  context_type: string;
  trigger_phrases: string | null;
  source_session: string | null;
  temporal_relevance: string;
  embedding: string | null;
  created_at: string;
  last_accessed: string | null;
  access_count: number;
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Search memories semantically using vector similarity.
 */
export async function searchMemories(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { config, limit = 5, minScore = 0.0 } = options;

  logger.debug(`Searching memories for: "${query}" (limit=${limit}, minScore=${minScore})`);

  // Generate query embedding
  const queryEmbedding = await embed(query, config);

  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Load all memories with embeddings
    const rows = db.query(
      'SELECT * FROM memories WHERE embedding IS NOT NULL',
    ).all() as MemoryWithEmbedding[];

    logger.debug(`Comparing against ${rows.length} memories with embeddings`);

    // Compute similarity scores
    const scored: { row: MemoryWithEmbedding; score: number }[] = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      let memoryEmbedding: number[];
      try {
        memoryEmbedding = JSON.parse(row.embedding) as number[];
      } catch {
        logger.warn(`Invalid embedding for memory ${row.id}, skipping`);
        continue;
      }

      const score = cosineSimilarity(queryEmbedding, memoryEmbedding);
      if (score >= minScore) {
        scored.push({ row, score });
      }
    }

    // Sort by score descending and take top N
    scored.sort((a, b) => b.score - a.score);
    const topResults = scored.slice(0, limit);

    // Fetch tags and build results
    const results: SearchResult[] = [];

    for (const { row, score } of topResults) {
      const tagRows = db.query(
        'SELECT tag FROM memory_tags WHERE memory_id = ?',
      ).all(row.id) as { tag: string }[];
      const tags = tagRows.map((r) => r.tag);

      // Update access tracking
      db.run(
        'UPDATE memories SET last_accessed = datetime(\'now\'), access_count = access_count + 1 WHERE id = ?',
        [row.id],
      );

      results.push({
        id: row.id,
        content: row.content,
        importance: row.importance,
        tags,
        contextType: (row.context_type as ContextType) || ContextType.PROJECT_CONTEXT,
        triggerPhrases: row.trigger_phrases ? JSON.parse(row.trigger_phrases) as string[] : [],
        sourceSession: row.source_session || '',
        temporalRelevance: (row.temporal_relevance as Memory['temporalRelevance']) || 'persistent',
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count,
        score,
      });
    }

    logger.debug(`Found ${results.length} results above threshold`);
    return results;
  } finally {
    closeDatabase();
  }
}
