/**
 * SQLite database initialization and access.
 * Uses Bun's built-in SQLite (bun:sqlite).
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { CREATE_MEMORIES_TABLE, CREATE_MEMORY_TAGS_TABLE, CREATE_EPISODES_TABLE, CREATE_EPISODE_TAGS_TABLE } from './schema';
import { logger } from '../utils/logger';

let db: Database | null = null;

/**
 * Initialize the SQLite database at the given path.
 * Creates tables if they don't exist.
 */
export function initDatabase(dbPath: string): Database {
  logger.debug(`Opening database at ${dbPath}`);

  db = new Database(dbPath, { create: true });

  // Enable WAL mode for better concurrent read performance
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  // Create tables
  db.run(CREATE_MEMORIES_TABLE);
  db.run(CREATE_MEMORY_TAGS_TABLE);
  db.run(CREATE_EPISODES_TABLE);
  db.run(CREATE_EPISODE_TAGS_TABLE);

  // Migration: add embedding column if it doesn't exist (for DBs created before Phase 1)
  try {
    db.run('ALTER TABLE memories ADD COLUMN embedding TEXT');
    logger.debug('Added embedding column to memories table');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add embedding_dim column for dimension tracking
  try {
    db.run('ALTER TABLE memories ADD COLUMN embedding_dim INTEGER');
    logger.debug('Added embedding_dim column to memories table');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add smart recall metadata columns
  const smartRecallColumns = [
    { name: 'question_types', type: 'TEXT' },
    { name: 'emotional_resonance', type: 'TEXT' },
    { name: 'problem_solution_pair', type: 'INTEGER DEFAULT 0' },
    { name: 'confidence_score', type: 'REAL DEFAULT 0.8' },
    { name: 'action_required', type: 'INTEGER DEFAULT 0' },
    { name: 'knowledge_domain', type: "TEXT DEFAULT ''" },
  ];
  for (const col of smartRecallColumns) {
    try {
      db.run(`ALTER TABLE memories ADD COLUMN ${col.name} ${col.type}`);
      logger.debug(`Added ${col.name} column to memories table`);
    } catch {
      // Column already exists — ignore
    }
  }

  // Migration: add episode_id column to memories for episode linking
  try {
    db.run('ALTER TABLE memories ADD COLUMN episode_id TEXT DEFAULT NULL');
    logger.debug('Added episode_id column to memories table');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add metadata column for richer extraction context
  try {
    db.run('ALTER TABLE memories ADD COLUMN metadata TEXT DEFAULT NULL');
    logger.debug('Added metadata column to memories table');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add source_agent column for agent attribution
  try {
    db.run('ALTER TABLE memories ADD COLUMN source_agent TEXT DEFAULT NULL');
    logger.debug('Added source_agent column to memories table');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add source_session_id column to episodes for import deduplication
  try {
    db.run('ALTER TABLE episodes ADD COLUMN source_session_id TEXT DEFAULT NULL');
    logger.debug('Added source_session_id column to episodes table');
  } catch {
    // Column already exists — ignore
  }

  // Index for fast duplicate lookups
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes(source_session_id)');
  } catch {
    // Index already exists — ignore
  }

  // Migration: add content_hash column for deduplication
  try {
    db.run('ALTER TABLE memories ADD COLUMN content_hash TEXT DEFAULT NULL');
    logger.debug('Added content_hash column to memories table');

    // Backfill hashes for existing memories
    const rows = db.query('SELECT id, content FROM memories WHERE content_hash IS NULL').all() as { id: string; content: string }[];
    if (rows.length > 0) {
      const updateStmt = db.prepare('UPDATE memories SET content_hash = ? WHERE id = ?');
      for (const row of rows) {
        const normalized = row.content.toLowerCase().trim().replace(/\s+/g, ' ');
        const hash = createHash('sha256').update(normalized).digest('hex');
        updateStmt.run(hash, row.id);
      }
      logger.debug(`Backfilled content_hash for ${rows.length} existing memories`);
    }
  } catch {
    // Column already exists — ignore
  }

  // Index for fast content hash lookups
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash)');
  } catch {
    // Index already exists — ignore
  }

  logger.debug('Database initialized successfully');
  return db;
}

/**
 * Get the current database instance.
 * Throws if not initialized.
 */
export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Run `lucid init` first.');
  }
  return db;
}

/**
 * Close the database connection.
 */
export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.debug('Database connection closed');
  }
}

/**
 * Get the number of memories in the database.
 */
export function getMemoryCount(database: Database): number {
  const row = database.query('SELECT COUNT(*) as count FROM memories').get() as { count: number };
  return row.count;
}

/**
 * Get the number of episodes in the database.
 */
export function getEpisodeCount(database: Database): number {
  try {
    const row = database.query('SELECT COUNT(*) as count FROM episodes').get() as { count: number };
    return row.count;
  } catch {
    // Table might not exist yet
    return 0;
  }
}

/**
 * Get distinct embedding dimensions present in the database.
 * Returns an array of { dim, count } objects.
 */
export function getEmbeddingDimStats(database: Database): { dim: number | null; count: number }[] {
  const rows = database.query(
    'SELECT embedding_dim as dim, COUNT(*) as count FROM memories WHERE embedding IS NOT NULL GROUP BY embedding_dim',
  ).all() as { dim: number | null; count: number }[];
  return rows;
}
