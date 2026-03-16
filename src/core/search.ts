/**
 * Semantic search over memories (placeholder for Phase 1).
 */

import { logger } from '../utils/logger';
import type { Config, Memory } from '../storage/schema';

export interface SearchResult extends Memory {
  score: number;
}

export interface SearchOptions {
  limit?: number;
  config: Config;
}

/**
 * Search memories semantically using vector similarity.
 * Stub — Phase 1.
 */
export async function searchMemories(_query: string, _options: SearchOptions): Promise<SearchResult[]> {
  logger.debug('searchMemories not yet implemented (Phase 1)');
  return [];
}
