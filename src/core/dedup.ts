/**
 * Semantic deduplication for memories.
 *
 * Provides both single-memory duplicate detection (for add-time checks)
 * and full-database deduplication scanning.
 */

import { createHash } from 'node:crypto';
import { logger } from '../utils/logger';
import { initDatabase, closeDatabase } from '../storage/db';
import { getDbPath } from '../config';
import { embed } from './embedder';
import { cosineSimilarity } from './search';
import type { Memory, Config } from '../storage/schema';
import { ContextType } from '../storage/schema';

// ─── Types ───────────────────────────────────────────────────────────

export interface DuplicateResult {
  memory: Memory;
  similarity: number;
}

export interface DuplicateGroup {
  memories: Memory[];
  similarity: number;
}

export interface DeduplicationReport {
  groups: DuplicateGroup[];
  totalMemories: number;
  duplicateGroups: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────

interface MemoryRow {
  id: string;
  content: string;
  importance: number;
  context_type: string;
  trigger_phrases: string | null;
  source_session: string | null;
  temporal_relevance: string;
  embedding: string | null;
  embedding_dim: number | null;
  created_at: string;
  last_accessed: string | null;
  access_count: number;
  question_types: string | null;
  emotional_resonance: string | null;
  problem_solution_pair: number;
  confidence_score: number;
  action_required: number;
  knowledge_domain: string | null;
  episode_id: string | null;
  metadata: string | null;
  source_agent: string | null;
  content_hash: string | null;
}

/**
 * Normalize content for hashing: lowercase, trim, collapse whitespace.
 */
export function normalizeContent(content: string): string {
  return content.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Compute SHA-256 hash of normalized content.
 */
export function computeContentHash(content: string): string {
  const normalized = normalizeContent(content);
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Convert a database row + tags into a Memory object.
 */
function rowToMemory(row: MemoryRow, tags: string[]): Memory {
  return {
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
    questionTypes: row.question_types ? JSON.parse(row.question_types) as string[] : [],
    emotionalResonance: row.emotional_resonance || '',
    problemSolutionPair: row.problem_solution_pair === 1,
    confidenceScore: row.confidence_score ?? 0.8,
    actionRequired: row.action_required === 1,
    knowledgeDomain: row.knowledge_domain || '',
    episodeId: row.episode_id || null,
    metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
    sourceAgent: row.source_agent || null,
    contentHash: row.content_hash || null,
  };
}

// ─── Core Functions ──────────────────────────────────────────────────

/**
 * Find duplicates of the given content among existing memories.
 *
 * Checks both exact content hash matches (fast path) and
 * semantic similarity via cosine similarity of embeddings.
 *
 * Returns matches above the threshold, sorted by similarity descending.
 */
export async function findDuplicates(
  content: string,
  config: Config,
  threshold: number = 0.92,
): Promise<DuplicateResult[]> {
  const contentHash = computeContentHash(content);
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    const results: DuplicateResult[] = [];

    // Fast path: exact hash match
    const hashMatches = db.query(
      'SELECT * FROM memories WHERE content_hash = ?',
    ).all(contentHash) as MemoryRow[];

    for (const row of hashMatches) {
      const tagRows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(row.id) as { tag: string }[];
      const tags = tagRows.map((r) => r.tag);
      results.push({
        memory: rowToMemory(row, tags),
        similarity: 1.0,
      });
    }

    // Semantic similarity check via embeddings
    let queryEmbedding: number[];
    try {
      queryEmbedding = await embed(content, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to generate embedding for dedup: ${message}`);
      return results; // Return hash matches only
    }

    const queryDim = queryEmbedding.length;
    const rows = db.query(
      'SELECT * FROM memories WHERE embedding IS NOT NULL AND (embedding_dim = ? OR embedding_dim IS NULL)',
    ).all(queryDim) as MemoryRow[];

    const hashMatchIds = new Set(hashMatches.map((r) => r.id));

    for (const row of rows) {
      if (hashMatchIds.has(row.id)) continue; // Already found via hash
      if (!row.embedding) continue;

      let memoryEmbedding: number[];
      try {
        memoryEmbedding = JSON.parse(row.embedding) as number[];
      } catch {
        continue;
      }

      if (memoryEmbedding.length !== queryDim) continue;

      const similarity = cosineSimilarity(queryEmbedding, memoryEmbedding);
      if (similarity >= threshold) {
        const tagRows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(row.id) as { tag: string }[];
        const tags = tagRows.map((r) => r.tag);
        results.push({
          memory: rowToMemory(row, tags),
          similarity,
        });
      }
    }

    // Sort by similarity descending
    results.sort((a, b) => b.similarity - a.similarity);

    return results;
  } finally {
    closeDatabase();
  }
}

/**
 * Scan all memories pairwise and find groups of near-duplicates.
 *
 * Uses embedding similarity (no LLM calls). Groups are formed using
 * a union-find approach: if A is similar to B and B is similar to C,
 * they all end up in the same group.
 */
export async function deduplicateAll(
  config: Config,
  threshold: number = 0.92,
): Promise<DeduplicationReport> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    const rows = db.query(
      'SELECT * FROM memories WHERE embedding IS NOT NULL',
    ).all() as MemoryRow[];

    const totalMemories = rows.length;

    // Parse embeddings
    const memoriesWithEmbeddings: { row: MemoryRow; embedding: number[] }[] = [];
    for (const row of rows) {
      if (!row.embedding) continue;
      try {
        const embedding = JSON.parse(row.embedding) as number[];
        memoriesWithEmbeddings.push({ row, embedding });
      } catch {
        continue;
      }
    }

    // Union-find for grouping
    const parent = new Map<number, number>();
    const find = (i: number): number => {
      if (!parent.has(i)) parent.set(i, i);
      if (parent.get(i) !== i) parent.set(i, find(parent.get(i)!));
      return parent.get(i)!;
    };
    const union = (i: number, j: number): void => {
      parent.set(find(i), find(j));
    };

    // Track best (lowest) similarity for each pair in a group
    const pairSimilarities = new Map<string, number>();

    // Pairwise comparison
    for (let i = 0; i < memoriesWithEmbeddings.length; i++) {
      for (let j = i + 1; j < memoriesWithEmbeddings.length; j++) {
        const a = memoriesWithEmbeddings[i];
        const b = memoriesWithEmbeddings[j];

        if (a.embedding.length !== b.embedding.length) continue;

        const similarity = cosineSimilarity(a.embedding, b.embedding);
        if (similarity >= threshold) {
          union(i, j);
          const key = `${Math.min(i, j)}-${Math.max(i, j)}`;
          const existing = pairSimilarities.get(key) ?? 1.0;
          pairSimilarities.set(key, Math.min(existing, similarity));
        }
      }
    }

    // Build groups from union-find
    const groupMap = new Map<number, number[]>();
    for (let i = 0; i < memoriesWithEmbeddings.length; i++) {
      const root = find(i);
      if (!groupMap.has(root)) groupMap.set(root, []);
      groupMap.get(root)!.push(i);
    }

    // Convert to DuplicateGroups (only groups with 2+ members)
    const groups: DuplicateGroup[] = [];
    for (const [, indices] of groupMap) {
      if (indices.length < 2) continue;

      // Find minimum similarity within the group
      let minSimilarity = 1.0;
      for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
          const key = `${Math.min(indices[i], indices[j])}-${Math.max(indices[i], indices[j])}`;
          const sim = pairSimilarities.get(key);
          if (sim !== undefined && sim < minSimilarity) {
            minSimilarity = sim;
          }
        }
      }

      const memories: Memory[] = indices.map((idx) => {
        const { row } = memoriesWithEmbeddings[idx];
        const tagRows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(row.id) as { tag: string }[];
        const tags = tagRows.map((r) => r.tag);
        return rowToMemory(row, tags);
      });

      groups.push({
        memories,
        similarity: minSimilarity,
      });
    }

    return {
      groups,
      totalMemories,
      duplicateGroups: groups.length,
    };
  } finally {
    closeDatabase();
  }
}
