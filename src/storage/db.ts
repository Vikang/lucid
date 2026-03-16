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
