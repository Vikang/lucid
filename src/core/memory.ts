/**
 * Memory CRUD operations (placeholder for Phase 1).
 *
 * Provides the core interface for creating, reading, updating, and deleting memories.
 */

import { logger } from '../utils/logger';
import type { Memory } from '../storage/schema';

export interface AddMemoryInput {
  content: string;
  importance?: number;
  tags?: string[];
  contextType?: string;
  triggerPhrases?: string[];
  sourceSession?: string;
  temporalRelevance?: 'persistent' | 'short-term' | 'expiring';
}

/**
 * Add a new memory to the store.
 * Stub — Phase 1.
 */
export async function addMemory(_input: AddMemoryInput): Promise<Memory> {
  logger.debug('addMemory not yet implemented (Phase 1)');
  throw new Error('Not implemented — coming in Phase 1');
}

/**
 * Get a memory by its ID.
 * Stub — Phase 1.
 */
export async function getMemory(_id: string): Promise<Memory | null> {
  logger.debug('getMemory not yet implemented (Phase 1)');
  return null;
}

/**
 * Delete a memory by its ID.
 * Stub — Phase 1.
 */
export async function deleteMemory(_id: string): Promise<boolean> {
  logger.debug('deleteMemory not yet implemented (Phase 1)');
  return false;
}

/**
 * List all memories, optionally filtered.
 * Stub — Phase 1.
 */
export async function listMemories(_options?: { tag?: string; limit?: number }): Promise<Memory[]> {
  logger.debug('listMemories not yet implemented (Phase 1)');
  return [];
}
