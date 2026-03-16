/**
 * Transcript → memory extraction via LLM (placeholder for Phase 1).
 *
 * The curator analyzes conversation transcripts and extracts
 * structured memories with importance scoring and categorization.
 */

import { logger } from '../utils/logger';
import type { Config } from '../storage/schema';
import type { AddMemoryInput } from './memory';

/**
 * Extract memories from a conversation transcript.
 * Stub — Phase 1.
 */
export async function curateTranscript(
  _transcript: string,
  _config: Config,
): Promise<AddMemoryInput[]> {
  logger.debug('curateTranscript not yet implemented (Phase 1)');
  return [];
}
