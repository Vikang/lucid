/**
 * SQLite database initialization and access.
 * Uses Bun's built-in SQLite (bun:sqlite).
 */

import { Database } from 'bun:sqlite';
import { CREATE_MEMORIES_TABLE, CREATE_MEMORY_TAGS_TABLE } from './schema';
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
 * Get distinct embedding dimensions present in the database.
 * Returns an array of { dim, count } objects.
 */
export function getEmbeddingDimStats(database: Database): { dim: number | null; count: number }[] {
  const rows = database.query(
    'SELECT embedding_dim as dim, COUNT(*) as count FROM memories WHERE embedding IS NOT NULL GROUP BY embedding_dim',
  ).all() as { dim: number | null; count: number }[];
  return rows;
}
