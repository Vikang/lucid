/**
 * Embedding generation (placeholder for Phase 1).
 *
 * Will support configurable providers: transformers.js (local) or OpenAI API.
 */

import { logger } from '../utils/logger';
import type { Config } from '../storage/schema';

/**
 * Generate an embedding vector for the given text.
 * Stub — Phase 1.
 */
export async function embed(_text: string, _config: Config): Promise<number[]> {
  logger.debug('embed not yet implemented (Phase 1)');
  return [];
}

/**
 * Generate embeddings for multiple texts in batch.
 * Stub — Phase 1.
 */
export async function embedBatch(_texts: string[], _config: Config): Promise<number[][]> {
  logger.debug('embedBatch not yet implemented (Phase 1)');
  return [];
}
