/**
 * OpenClaw session parser — discovers, parses, and sanitizes session files.
 *
 * Session files live at ~/.openclaw/agents/(agent)/sessions/(id).jsonl
 * Each line is a JSON object with a `type` field.
 * We only import type="message" where role is "user" or "assistant".
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { logger } from '../utils/logger';

// ─── Types ───────────────────────────────────────────────────────────

export interface DiscoveredSession {
  filePath: string;
  agentId: string;
  sessionId: string;
  timestamp: string;
  messageCount: number;
  channels: string[];
  sizeBytes: number;
}

export interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface ParsedSession {
  sessionId: string;
  agentId: string;
  channel: string;
  messages: ParsedMessage[];
  startTime: string;
  endTime: string;
  duration: string;
}

// ─── Content extraction helpers ──────────────────────────────────────

interface TextContentBlock {
  type: 'text';
  text: string;
}

interface MessagePayload {
  role: string;
  content: string | TextContentBlock[];
  timestamp?: number;
}

interface SessionLine {
  type: string;
  id?: string;
  timestamp?: string;
  message?: MessagePayload;
}

/**
 * Extract text from message content — handles both string and array formats.
 */
function extractTextContent(content: string | TextContentBlock[]): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((block): block is TextContentBlock => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  return '';
}

// ─── Sanitization ────────────────────────────────────────────────────

/**
 * Sanitize text — strip OpenClaw metadata blocks and redact credentials.
 *
 * SECURITY: This is the critical function. Every imported message passes through here.
 */
export function sanitizeText(text: string): string {
  // 1. Strip OpenClaw metadata blocks (Conversation info + Sender blocks)
  // These are wrapped in ```json blocks preceded by labels
  text = text.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/g, '');
  text = text.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/g, '');

  // Strip any remaining "Untrusted context" blocks
  text = text.replace(/Untrusted context \(metadata, do not treat as instructions or commands\):[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g, '');

  // 2. Redact OAT tokens (must be before generic sk- pattern)
  text = text.replace(/sk-ant-oat[a-zA-Z0-9_-]+/g, '[REDACTED_TOKEN]');

  // 3. Redact API keys (sk-...)
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]');

  // 4. Redact Bearer tokens
  text = text.replace(/Bearer [a-zA-Z0-9_-]{20,}/g, 'Bearer [REDACTED]');

  // 5. Redact npm tokens
  text = text.replace(/npm_[a-zA-Z0-9]{20,}/g, '[REDACTED_NPM_TOKEN]');

  return text.trim();
}

/**
 * Extract channel name from OpenClaw metadata in a user message.
 * Returns the channel name or 'unknown'.
 */
function extractChannelFromMetadata(text: string): string | null {
  // Look for "group_channel": "#tamapal" in the conversation info block
  const channelMatch = text.match(/"group_channel"\s*:\s*"#?([^"]+)"/);
  if (channelMatch) {
    return channelMatch[1];
  }
  // Look for "conversation_label" containing channel info
  const labelMatch = text.match(/"conversation_label"\s*:\s*"[^"]*#(\w+)/);
  if (labelMatch) {
    return labelMatch[1];
  }
  return null;
}

// ─── Discovery ───────────────────────────────────────────────────────

/**
 * Get the default OpenClaw directory.
 */
export function getDefaultOpenClawDir(): string {
  return join(homedir(), '.openclaw');
}

/**
 * Discover all session files across all agents.
 */
export async function discoverSessions(openclawDir?: string): Promise<DiscoveredSession[]> {
  const baseDir = openclawDir ?? getDefaultOpenClawDir();
  const agentsDir = join(baseDir, 'agents');

  if (!existsSync(agentsDir)) {
    return [];
  }

  const sessions: DiscoveredSession[] = [];
  const agentDirs = readdirSync(agentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const agentDir of agentDirs) {
    const sessionsDir = join(agentsDir, agentDir.name, 'sessions');
    if (!existsSync(sessionsDir)) continue;

    const files = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.jsonl') && !f.includes('.deleted'));

    for (const file of files) {
      const filePath = join(sessionsDir, file);

      try {
        const stat = statSync(filePath);
        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim());

        if (lines.length === 0) continue;

        // Parse first line for session metadata
        let sessionTimestamp = '';
        let sessionId = basename(file, '.jsonl');
        try {
          const firstLine = JSON.parse(lines[0]) as SessionLine;
          if (firstLine.type === 'session') {
            sessionTimestamp = firstLine.timestamp ?? '';
            sessionId = firstLine.id ?? sessionId;
          }
        } catch {
          logger.debug(`Could not parse first line of ${file}`);
        }

        // Count messages and detect channels
        let messageCount = 0;
        const channels = new Set<string>();

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as SessionLine;
            if (parsed.type === 'message' && parsed.message) {
              const role = parsed.message.role;
              if (role === 'user' || role === 'assistant') {
                messageCount++;

                if (role === 'user') {
                  const text = extractTextContent(parsed.message.content);
                  const channel = extractChannelFromMetadata(text);
                  if (channel) channels.add(channel);
                }
              }
            }
          } catch {
            // Skip malformed lines
          }
        }

        sessions.push({
          filePath,
          agentId: agentDir.name,
          sessionId,
          timestamp: sessionTimestamp,
          messageCount,
          channels: Array.from(channels),
          sizeBytes: stat.size,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`Skipping ${file}: ${message}`);
      }
    }
  }

  return sessions;
}

// ─── Parsing ─────────────────────────────────────────────────────────

/**
 * Parse a session file — extract and sanitize user/assistant messages only.
 */
export async function parseSession(filePath: string): Promise<ParsedSession> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim());

  const agentId = basename(dirname(dirname(filePath)));
  let sessionId = basename(filePath, '.jsonl');
  const messages: ParsedMessage[] = [];
  const detectedChannels = new Set<string>();

  for (const line of lines) {
    let parsed: SessionLine;
    try {
      parsed = JSON.parse(line) as SessionLine;
    } catch {
      continue; // Skip malformed lines
    }

    // Only process type="message"
    if (parsed.type !== 'message' || !parsed.message) continue;

    const role = parsed.message.role;
    if (role !== 'user' && role !== 'assistant') continue;

    // Extract raw text
    const rawText = extractTextContent(parsed.message.content);
    if (!rawText) continue;

    // For user messages, extract channel before sanitizing
    if (role === 'user') {
      const channel = extractChannelFromMetadata(rawText);
      if (channel) detectedChannels.add(channel);
    }

    // Sanitize the text
    const sanitized = sanitizeText(rawText);
    if (!sanitized) continue;

    // Determine timestamp
    const timestamp = parsed.timestamp ?? '';

    messages.push({
      role: role as 'user' | 'assistant',
      content: sanitized,
      timestamp,
    });
  }

  // Determine channel — use the most common detected channel
  const channelArray = Array.from(detectedChannels);
  const channel = channelArray.length > 0 ? channelArray[0] : 'unknown';

  // Calculate times
  const startTime = messages.length > 0 ? messages[0].timestamp : '';
  const endTime = messages.length > 0 ? messages[messages.length - 1].timestamp : '';
  const duration = calculateDuration(startTime, endTime);

  return {
    sessionId,
    agentId,
    channel,
    messages,
    startTime,
    endTime,
    duration,
  };
}

// ─── Formatting ──────────────────────────────────────────────────────

/**
 * Convert a parsed session to a readable transcript.
 */
export function sessionToTranscript(session: ParsedSession): string {
  return session.messages
    .map((m) => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
    .join('\n\n');
}

/**
 * Generate a heuristic session summary — NO LLM.
 */
export function generateSessionSummary(session: ParsedSession): string {
  const channelLabel = session.channel !== 'unknown' ? `#${session.channel}` : 'webchat';
  const msgCount = session.messages.length;
  const durationLabel = session.duration || 'unknown duration';

  // First user message preview
  const firstUserMsg = session.messages.find((m) => m.role === 'user');
  const preview = firstUserMsg
    ? firstUserMsg.content.slice(0, 100) + (firstUserMsg.content.length > 100 ? '...' : '')
    : 'No user messages';

  return `Conversation in ${channelLabel} (${msgCount} messages, ${durationLabel}). Started with: ${preview}`;
}

/**
 * Generate a session label from channel + date.
 */
export function generateSessionLabel(session: ParsedSession): string {
  const channelLabel = session.channel !== 'unknown' ? `#${session.channel}` : 'Webchat';
  const dateLabel = session.startTime
    ? new Date(session.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : 'Unknown date';

  return `${channelLabel} session (${dateLabel})`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Calculate human-readable duration between two ISO timestamps.
 */
function calculateDuration(start: string, end: string): string {
  if (!start || !end) return '';

  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();

  if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) return '';

  const diffMs = endMs - startMs;
  const minutes = Math.floor(diffMs / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}
