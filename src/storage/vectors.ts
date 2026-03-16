/**
 * Vector index operations (placeholder for Phase 1).
 *
 * Will use vectra for local vector search once embeddings are integrated.
 */

import { logger } from '../utils/logger';

/**
 * Initialize the vector index at the given directory.
 * Stub — Phase 1.
 */
export function initVectorIndex(_vectorDir: string): void {
  logger.debug('Vector index not yet implemented (Phase 1)');
}

/**
 * Add a vector to the index.
 * Stub — Phase 1.
 */
export function addVector(_id: string, _embedding: number[]): void {
  logger.debug('addVector not yet implemented (Phase 1)');
}

/**
 * Search the vector index.
 * Stub — Phase 1.
 */
export function searchVectors(_query: number[], _limit: number): { id: string; score: number }[] {
  logger.debug('searchVectors not yet implemented (Phase 1)');
  return [];
}
