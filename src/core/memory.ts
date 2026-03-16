/**
 * Memory CRUD operations.
 *
 * Core interface for creating, reading, and deleting memories.
 * All database access goes through this module.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { initDatabase, closeDatabase } from '../storage/db';
import { getDbPath } from '../config';
import { embed } from './embedder';
import type { Memory, Config } from '../storage/schema';
import { ContextType } from '../storage/schema';

export interface AddMemoryInput {
  content: string;
  importance?: number;
  tags?: string[];
  contextType?: string;
  triggerPhrases?: string[];
  sourceSession?: string;
  temporalRelevance?: 'persistent' | 'short-term' | 'expiring';
  // NEW — smart recall metadata
  questionTypes?: string[];
  emotionalResonance?: string;
  problemSolutionPair?: boolean;
  confidenceScore?: number;
  actionRequired?: boolean;
  knowledgeDomain?: string;
}

interface MemoryRow {
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
  // NEW — smart recall metadata
  question_types: string | null;
  emotional_resonance: string | null;
  problem_solution_pair: number;
  confidence_score: number;
  action_required: number;
  knowledge_domain: string | null;
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
    // NEW — smart recall metadata
    questionTypes: row.question_types ? JSON.parse(row.question_types) as string[] : [],
    emotionalResonance: row.emotional_resonance || '',
    problemSolutionPair: row.problem_solution_pair === 1,
    confidenceScore: row.confidence_score ?? 0.8,
    actionRequired: row.action_required === 1,
    knowledgeDomain: row.knowledge_domain || '',
  };
}

/**
 * Add a new memory to the store.
 * Generates an embedding and stores everything in SQLite.
 */
export async function addMemory(input: AddMemoryInput, config: Config): Promise<Memory> {
  const id = uuidv4();
  const now = new Date().toISOString();
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Generate embedding
    let embeddingJson: string | null = null;
    let embeddingDim: number | null = null;
    try {
      const vector = await embed(input.content, config);
      embeddingJson = JSON.stringify(vector);
      embeddingDim = vector.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`Failed to generate embedding: ${message}. Memory saved without embedding.`);
    }

    // Insert memory row
    db.run(
      `INSERT INTO memories (id, content, importance, context_type, trigger_phrases, source_session, temporal_relevance, embedding, embedding_dim, created_at, last_accessed, access_count, question_types, emotional_resonance, problem_solution_pair, confidence_score, action_required, knowledge_domain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.content,
        input.importance ?? 0.5,
        input.contextType ?? 'PROJECT_CONTEXT',
        input.triggerPhrases ? JSON.stringify(input.triggerPhrases) : null,
        input.sourceSession ?? now,
        input.temporalRelevance ?? 'persistent',
        embeddingJson,
        embeddingDim,
        now,
        input.questionTypes ? JSON.stringify(input.questionTypes) : null,
        input.emotionalResonance ?? '',
        input.problemSolutionPair ? 1 : 0,
        input.confidenceScore ?? 0.8,
        input.actionRequired ? 1 : 0,
        input.knowledgeDomain ?? '',
      ],
    );

    // Insert tags
    const tags = input.tags ?? [];
    for (const tag of tags) {
      db.run('INSERT OR IGNORE INTO memory_tags (memory_id, tag) VALUES (?, ?)', [id, tag]);
    }

    logger.debug(`Added memory ${id} with ${tags.length} tags`);

    return {
      id,
      content: input.content,
      importance: input.importance ?? 0.5,
      tags,
      contextType: (input.contextType as ContextType) ?? ContextType.PROJECT_CONTEXT,
      triggerPhrases: input.triggerPhrases ?? [],
      sourceSession: input.sourceSession ?? now,
      temporalRelevance: input.temporalRelevance ?? 'persistent',
      createdAt: now,
      lastAccessed: null,
      accessCount: 0,
      // NEW — smart recall metadata
      questionTypes: input.questionTypes ?? [],
      emotionalResonance: input.emotionalResonance ?? '',
      problemSolutionPair: input.problemSolutionPair ?? false,
      confidenceScore: input.confidenceScore ?? 0.8,
      actionRequired: input.actionRequired ?? false,
      knowledgeDomain: input.knowledgeDomain ?? '',
    };
  } finally {
    closeDatabase();
  }
}

/**
 * Get a memory by its ID, with tags joined.
 */
export async function getMemory(id: string, config: Config): Promise<Memory | null> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    const row = db.query('SELECT * FROM memories WHERE id = ?').get(id) as MemoryRow | null;
    if (!row) return null;

    const tagRows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(id) as { tag: string }[];
    const tags = tagRows.map((r) => r.tag);

    return rowToMemory(row, tags);
  } finally {
    closeDatabase();
  }
}

/**
 * Delete a memory by its ID. Tags cascade via foreign key.
 */
export async function deleteMemory(id: string, config: Config): Promise<boolean> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Delete tags first (in case FK cascade isn't working)
    db.run('DELETE FROM memory_tags WHERE memory_id = ?', [id]);
    const result = db.run('DELETE FROM memories WHERE id = ?', [id]);
    const deleted = result.changes > 0;

    if (deleted) {
      logger.debug(`Deleted memory ${id}`);
    } else {
      logger.debug(`Memory ${id} not found`);
    }

    return deleted;
  } finally {
    closeDatabase();
  }
}

/**
 * List memories with optional filtering.
 */
export async function listMemories(
  config: Config,
  options?: { tag?: string; limit?: number },
): Promise<Memory[]> {
  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);
  const limit = options?.limit ?? 20;

  try {
    let rows: MemoryRow[];

    if (options?.tag) {
      rows = db.query(
        `SELECT m.* FROM memories m
         JOIN memory_tags mt ON m.id = mt.memory_id
         WHERE mt.tag = ?
         ORDER BY m.created_at DESC
         LIMIT ?`,
      ).all(options.tag, limit) as MemoryRow[];
    } else {
      rows = db.query(
        'SELECT * FROM memories ORDER BY created_at DESC LIMIT ?',
      ).all(limit) as MemoryRow[];
    }

    return rows.map((row) => {
      const tagRows = db.query('SELECT tag FROM memory_tags WHERE memory_id = ?').all(row.id) as { tag: string }[];
      const tags = tagRows.map((r) => r.tag);
      return rowToMemory(row, tags);
    });
  } finally {
    closeDatabase();
  }
}
