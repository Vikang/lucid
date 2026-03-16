/**
 * Transcript parsing utilities (placeholder for Phase 1).
 *
 * Will handle parsing conversation transcripts from stdin, files, or pipes.
 */

import { logger } from './logger';

export interface TranscriptEntry {
  role: string;
  content: string;
  timestamp?: string;
}

/**
 * Parse a raw transcript string into structured entries.
 * Stub — Phase 1.
 */
export function parseTranscript(_raw: string): TranscriptEntry[] {
  logger.debug('parseTranscript not yet implemented (Phase 1)');
  return [];
}

/**
 * Read a transcript from a file path.
 * Stub — Phase 1.
 */
export async function readTranscriptFile(_filePath: string): Promise<string> {
  logger.debug('readTranscriptFile not yet implemented (Phase 1)');
  return '';
}
