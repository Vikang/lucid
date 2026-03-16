/**
 * Transcript parsing utilities.
 *
 * Handles reading conversation transcripts from stdin, files, or direct text input.
 * Returns clean text strings — the LLM handles understanding conversation structure.
 */

import { readFileSync, existsSync } from 'node:fs';
import { logger } from './logger';

export interface TranscriptEntry {
  role: string;
  content: string;
  timestamp?: string;
}

/**
 * Read a transcript from one of three input modes:
 * 1. File path (--file)
 * 2. Direct string (--text)
 * 3. Stdin pipe
 *
 * Returns the raw transcript text, cleaned up but not over-processed.
 */
export async function readTranscript(options: {
  file?: string;
  text?: string;
}): Promise<string> {
  if (options.text) {
    logger.debug('Reading transcript from --text argument');
    return cleanTranscript(options.text);
  }

  if (options.file) {
    logger.debug(`Reading transcript from file: ${options.file}`);
    return readTranscriptFile(options.file);
  }

  logger.debug('Reading transcript from stdin');
  return readTranscriptStdin();
}

/**
 * Read a transcript from a file path.
 */
export async function readTranscriptFile(filePath: string): Promise<string> {
  if (!existsSync(filePath)) {
    throw new Error(`Transcript file not found: ${filePath}. Check the path and try again.`);
  }

  const raw = readFileSync(filePath, 'utf-8');
  if (!raw.trim()) {
    throw new Error(`Transcript file is empty: ${filePath}`);
  }

  return cleanTranscript(raw);
}

/**
 * Read a transcript from stdin (piped input).
 */
async function readTranscriptStdin(): Promise<string> {
  const chunks: string[] = [];

  const reader = Bun.stdin.stream().getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    reader.releaseLock();
  }

  const raw = chunks.join('');
  if (!raw.trim()) {
    throw new Error(
      'No input received. Provide a transcript via:\n' +
      '  --file <path>     Read from a file\n' +
      '  --text "..."      Pass text directly\n' +
      '  cat file | lucid  Pipe from stdin',
    );
  }

  return cleanTranscript(raw);
}

/**
 * Clean up a raw transcript string.
 * Normalizes whitespace and trims, but preserves conversation structure.
 * The LLM handles parsing the actual conversation format.
 */
function cleanTranscript(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')  // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')  // Collapse excessive blank lines
    .trim();
}

/**
 * Parse a raw transcript string into structured entries.
 * Handles common formats: Human/Assistant, User/Assistant, quoted blocks.
 */
export function parseTranscript(raw: string): TranscriptEntry[] {
  const cleaned = cleanTranscript(raw);
  const entries: TranscriptEntry[] = [];

  // Try Human:/Assistant: or User:/Assistant: format
  const turnPattern = /^(Human|User|Assistant|System):\s*/gm;
  const matches = [...cleaned.matchAll(turnPattern)];

  if (matches.length >= 2) {
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const role = match[1].toLowerCase();
      const startIdx = match.index! + match[0].length;
      const endIdx = i + 1 < matches.length ? matches[i + 1].index! : cleaned.length;
      const content = cleaned.slice(startIdx, endIdx).trim();

      if (content) {
        entries.push({ role, content });
      }
    }
    return entries;
  }

  // Fallback: treat entire input as one block
  entries.push({ role: 'unknown', content: cleaned });
  return entries;
}
