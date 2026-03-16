/**
 * Tests for OpenClaw session import — sanitization, parser, engine, and security.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sanitizeText,
  discoverSessions,
  parseSession,
  sessionToTranscript,
  generateSessionSummary,
  generateSessionLabel,
} from '../src/import/openclaw';
import { importOpenClaw } from '../src/import/engine';
import { loadConfig } from '../src/config';
import { initDatabase, closeDatabase } from '../src/storage/db';

// ─── Test fixtures ───────────────────────────────────────────────────

const METADATA_BLOCK = `Conversation info (untrusted metadata):
\`\`\`json
{
  "message_id": "123456",
  "sender_id": "789",
  "conversation_label": "Guild #tamapal channel id:123",
  "sender": "vikang",
  "timestamp": "Mon 2026-03-15 10:00 PDT",
  "group_subject": "#tamapal",
  "group_channel": "#tamapal",
  "group_space": "999",
  "is_group_chat": true
}
\`\`\`

Sender (untrusted metadata):
\`\`\`json
{
  "label": "vikang (789)",
  "id": "789",
  "name": "vikang",
  "username": "vikang",
  "tag": "vikang"
}
\`\`\`

What should we build today?`;

const SESSION_JSONL = (sessionId: string, timestamp: string) => [
  JSON.stringify({ type: 'session', version: 3, id: sessionId, timestamp, cwd: '/tmp' }),
  JSON.stringify({ type: 'model_change', id: 'mc1', timestamp, provider: 'anthropic', modelId: 'claude-4' }),
  JSON.stringify({
    type: 'message', id: 'msg1', timestamp,
    message: { role: 'user', content: [{ type: 'text', text: METADATA_BLOCK }] },
  }),
  JSON.stringify({
    type: 'message', id: 'msg2', timestamp: new Date(new Date(timestamp).getTime() + 60000).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text: 'Let me help you build something awesome!' }] },
  }),
  JSON.stringify({
    type: 'message', id: 'msg3', timestamp: new Date(new Date(timestamp).getTime() + 120000).toISOString(),
    message: { role: 'user', content: [{ type: 'text', text: 'Sounds great, let\'s start with the API.' }] },
  }),
  JSON.stringify({
    type: 'message', id: 'msg4', timestamp: new Date(new Date(timestamp).getTime() + 180000).toISOString(),
    message: { role: 'assistant', content: [{ type: 'text', text: 'Here is the plan for the API...' }] },
  }),
  JSON.stringify({
    type: 'message', id: 'msg-tool', timestamp: new Date(new Date(timestamp).getTime() + 190000).toISOString(),
    message: {
      role: 'toolResult', toolCallId: 'tc1', toolName: 'exec',
      content: [{ type: 'text', text: 'some tool output with sk-abc123def456ghi789jkl01234 in it' }],
    },
  }),
  JSON.stringify({ type: 'custom', customType: 'model-snapshot', data: { provider: 'anthropic' }, id: 'cs1', timestamp }),
].join('\n');

// ─── Temp dir management ─────────────────────────────────────────────

let tempDir: string;
let tempDbPath: string;

function setupTempDir(): string {
  const dir = join(tmpdir(), `lucid-import-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createTestOpenClawDir(baseDir: string, agents: Record<string, { sessionId: string; timestamp: string; content?: string }[]>): string {
  const openclawDir = join(baseDir, '.openclaw');
  for (const [agent, sessions] of Object.entries(agents)) {
    const sessionsDir = join(openclawDir, 'agents', agent, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    for (const s of sessions) {
      const content = s.content ?? SESSION_JSONL(s.sessionId, s.timestamp);
      writeFileSync(join(sessionsDir, `${s.sessionId}.jsonl`), content);
    }
  }
  return openclawDir;
}

function getTestConfig() {
  return {
    ...loadConfig(),
    dataDir: tempDir,
  };
}

beforeEach(() => {
  tempDir = setupTempDir();
  tempDbPath = join(tempDir, 'memories.db');
});

afterEach(() => {
  closeDatabase();
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ─── Sanitization tests ─────────────────────────────────────────────

describe('sanitizeText', () => {
  test('strips OpenClaw metadata blocks', () => {
    const result = sanitizeText(METADATA_BLOCK);
    expect(result).toBe('What should we build today?');
    expect(result).not.toContain('untrusted metadata');
    expect(result).not.toContain('vikang');
    expect(result).not.toContain('group_channel');
  });

  test('redacts API keys (sk-...)', () => {
    const text = 'My key is sk-abc123def456ghi789jkl01234 and here is more text';
    const result = sanitizeText(text);
    expect(result).toBe('My key is [REDACTED_API_KEY] and here is more text');
    expect(result).not.toContain('sk-abc');
  });

  test('redacts OAT tokens (sk-ant-oat-...)', () => {
    const text = 'Token: sk-ant-oat-abc123def456ghi789jkl_mn-op';
    const result = sanitizeText(text);
    expect(result).toBe('Token: [REDACTED_TOKEN]');
    expect(result).not.toContain('sk-ant-oat');
  });

  test('redacts Bearer tokens', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = sanitizeText(text);
    expect(result).toBe('Authorization: Bearer [REDACTED]');
    expect(result).not.toContain('eyJhbG');
  });

  test('redacts npm tokens', () => {
    const text = 'npm token: npm_abcdefghijklmnopqrstuvwxyz';
    const result = sanitizeText(text);
    expect(result).toBe('npm token: [REDACTED_NPM_TOKEN]');
    expect(result).not.toContain('npm_abc');
  });

  test('preserves normal conversation text', () => {
    const text = 'Hello, how are you doing today? Let\'s build a cool app together.';
    const result = sanitizeText(text);
    expect(result).toBe(text);
  });

  test('handles text with no sensitive data (no-op)', () => {
    const text = 'Just a normal message with no secrets.';
    const result = sanitizeText(text);
    expect(result).toBe(text);
  });

  test('handles multiple sensitive patterns in one text', () => {
    const text = 'Key: sk-abc123def456ghi789jkl01234, Token: npm_abcdefghijklmnopqrstuvwxyz, Auth: Bearer someReallyLongTokenValue12345';
    const result = sanitizeText(text);
    expect(result).not.toContain('sk-abc');
    expect(result).not.toContain('npm_abc');
    expect(result).not.toContain('someReally');
    expect(result).toContain('[REDACTED_API_KEY]');
    expect(result).toContain('[REDACTED_NPM_TOKEN]');
    expect(result).toContain('Bearer [REDACTED]');
  });

  test('OAT tokens are redacted before generic sk- pattern', () => {
    const text = 'sk-ant-oat-abc123def456ghi789jkl_mn-op';
    const result = sanitizeText(text);
    expect(result).toBe('[REDACTED_TOKEN]');
    // Should NOT produce [REDACTED_API_KEY] for OAT tokens
    expect(result).not.toContain('[REDACTED_API_KEY]');
  });
});

// ─── Parser tests ────────────────────────────────────────────────────

describe('parseSession', () => {
  test('extracts user and assistant messages', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'test-session-1', timestamp: '2026-03-15T10:00:00.000Z' }],
    });
    const filePath = join(openclawDir, 'agents', 'zoro', 'sessions', 'test-session-1.jsonl');
    const session = await parseSession(filePath);

    // Should have 4 messages (2 user + 2 assistant)
    expect(session.messages.length).toBe(4);
    const roles = session.messages.map((m) => m.role);
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  test('skips toolResult lines', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'test-session-2', timestamp: '2026-03-15T10:00:00.000Z' }],
    });
    const filePath = join(openclawDir, 'agents', 'zoro', 'sessions', 'test-session-2.jsonl');
    const session = await parseSession(filePath);

    // None of the messages should have tool output
    for (const msg of session.messages) {
      expect(msg.content).not.toContain('some tool output');
    }
  });

  test('handles string content format', async () => {
    const sessionId = 'test-string-content';
    const timestamp = '2026-03-15T10:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp }),
      JSON.stringify({
        type: 'message', id: 'm1', timestamp,
        message: { role: 'user', content: 'Hello from string content' },
      }),
      JSON.stringify({
        type: 'message', id: 'm2', timestamp,
        message: { role: 'assistant', content: 'Response from string content' },
      }),
      JSON.stringify({
        type: 'message', id: 'm3', timestamp,
        message: { role: 'user', content: 'Another message' },
      }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      main: [{ sessionId, timestamp, content: lines }],
    });
    const filePath = join(openclawDir, 'agents', 'main', 'sessions', `${sessionId}.jsonl`);
    const session = await parseSession(filePath);

    expect(session.messages.length).toBe(3);
    expect(session.messages[0].content).toBe('Hello from string content');
  });

  test('handles array content format', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'test-array', timestamp: '2026-03-15T10:00:00.000Z' }],
    });
    const filePath = join(openclawDir, 'agents', 'zoro', 'sessions', 'test-array.jsonl');
    const session = await parseSession(filePath);

    // First user message should have metadata stripped
    expect(session.messages[0].content).toBe('What should we build today?');
  });

  test('detects channel from metadata', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'test-channel', timestamp: '2026-03-15T10:00:00.000Z' }],
    });
    const filePath = join(openclawDir, 'agents', 'zoro', 'sessions', 'test-channel.jsonl');
    const session = await parseSession(filePath);

    expect(session.channel).toBe('tamapal');
  });

  test('calculates duration', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'test-duration', timestamp: '2026-03-15T10:00:00.000Z' }],
    });
    const filePath = join(openclawDir, 'agents', 'zoro', 'sessions', 'test-duration.jsonl');
    const session = await parseSession(filePath);

    expect(session.duration).toBe('3m');
  });
});

describe('sessionToTranscript', () => {
  test('formats correctly', () => {
    const session = {
      sessionId: 'test',
      agentId: 'zoro',
      channel: 'tamapal',
      messages: [
        { role: 'user' as const, content: 'Hello', timestamp: '2026-03-15T10:00:00.000Z' },
        { role: 'assistant' as const, content: 'Hi there!', timestamp: '2026-03-15T10:01:00.000Z' },
      ],
      startTime: '2026-03-15T10:00:00.000Z',
      endTime: '2026-03-15T10:01:00.000Z',
      duration: '1m',
    };

    const transcript = sessionToTranscript(session);
    expect(transcript).toBe('Human: Hello\n\nAssistant: Hi there!');
  });
});

describe('generateSessionSummary', () => {
  test('creates reasonable summary', () => {
    const session = {
      sessionId: 'test',
      agentId: 'zoro',
      channel: 'tamapal',
      messages: [
        { role: 'user' as const, content: 'What should we build today?', timestamp: '' },
        { role: 'assistant' as const, content: 'Something cool!', timestamp: '' },
        { role: 'user' as const, content: 'Sounds good.', timestamp: '' },
      ],
      startTime: '',
      endTime: '',
      duration: '5m',
    };

    const summary = generateSessionSummary(session);
    expect(summary).toContain('#tamapal');
    expect(summary).toContain('3 messages');
    expect(summary).toContain('5m');
    expect(summary).toContain('What should we build today?');
  });
});

describe('generateSessionLabel', () => {
  test('creates channel+date label', () => {
    const session = {
      sessionId: 'test',
      agentId: 'zoro',
      channel: 'lucid',
      messages: [],
      startTime: '2026-03-16T10:00:00.000Z',
      endTime: '2026-03-16T11:00:00.000Z',
      duration: '1h',
    };

    const label = generateSessionLabel(session);
    expect(label).toContain('#lucid');
    expect(label).toContain('Mar');
  });

  test('uses Webchat for unknown channel', () => {
    const session = {
      sessionId: 'test',
      agentId: 'main',
      channel: 'unknown',
      messages: [],
      startTime: '2026-03-16T10:00:00.000Z',
      endTime: '',
      duration: '',
    };

    const label = generateSessionLabel(session);
    expect(label).toContain('Webchat');
  });
});

// ─── Discovery tests ────────────────────────────────────────────────

describe('discoverSessions', () => {
  test('discovers sessions across agents', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [
        { sessionId: 'session-1', timestamp: '2026-03-15T10:00:00.000Z' },
        { sessionId: 'session-2', timestamp: '2026-03-16T10:00:00.000Z' },
      ],
      robin: [
        { sessionId: 'session-3', timestamp: '2026-03-15T12:00:00.000Z' },
      ],
    });

    const sessions = await discoverSessions(openclawDir);
    expect(sessions.length).toBe(3);

    const agents = sessions.map((s) => s.agentId).sort();
    expect(agents).toEqual(['robin', 'zoro', 'zoro']);
  });

  test('skips .deleted files', async () => {
    const openclawDir = join(tempDir, '.openclaw');
    const sessionsDir = join(openclawDir, 'agents', 'zoro', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });

    writeFileSync(join(sessionsDir, 'good.jsonl'), SESSION_JSONL('good', '2026-03-15T10:00:00.000Z'));
    writeFileSync(join(sessionsDir, 'bad.deleted.jsonl'), SESSION_JSONL('bad', '2026-03-15T10:00:00.000Z'));

    const sessions = await discoverSessions(openclawDir);
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe('good');
  });

  test('handles missing openclaw directory gracefully', async () => {
    const sessions = await discoverSessions(join(tempDir, 'nonexistent'));
    expect(sessions).toEqual([]);
  });
});

// ─── Import engine tests ────────────────────────────────────────────

describe('importOpenClaw', () => {
  test('with --dry-run makes no changes', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'dry-run-1', timestamp: '2026-03-15T10:00:00.000Z' }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir,
      dryRun: true,
      yes: true,
    });

    expect(result.episodesCreated).toBe(0);
  });

  test('creates episodes for valid sessions', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'import-1', timestamp: '2026-03-15T10:00:00.000Z' }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir,
      yes: true,
    });

    expect(result.sessionsImported).toBe(1);
    expect(result.episodesCreated).toBe(1);
  });

  test('skips sessions with < 3 messages', async () => {
    const sessionId = 'short-session';
    const timestamp = '2026-03-15T10:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp }),
      JSON.stringify({
        type: 'message', id: 'm1', timestamp,
        message: { role: 'user', content: 'Hi' },
      }),
      JSON.stringify({
        type: 'message', id: 'm2', timestamp,
        message: { role: 'assistant', content: 'Hello' },
      }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId, timestamp, content: lines }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir,
      yes: true,
    });

    expect(result.sessionsSkipped).toBe(1);
    expect(result.episodesCreated).toBe(0);
  });

  test('respects --channel filter', async () => {
    // Create two sessions — one with tamapal channel, one without metadata
    const noChannelContent = [
      JSON.stringify({ type: 'session', id: 'no-channel', timestamp: '2026-03-15T10:00:00.000Z' }),
      JSON.stringify({ type: 'message', id: 'm1', timestamp: '2026-03-15T10:00:00.000Z', message: { role: 'user', content: 'plain message 1' } }),
      JSON.stringify({ type: 'message', id: 'm2', timestamp: '2026-03-15T10:01:00.000Z', message: { role: 'assistant', content: 'response 1' } }),
      JSON.stringify({ type: 'message', id: 'm3', timestamp: '2026-03-15T10:02:00.000Z', message: { role: 'user', content: 'plain message 2' } }),
      JSON.stringify({ type: 'message', id: 'm4', timestamp: '2026-03-15T10:03:00.000Z', message: { role: 'assistant', content: 'response 2' } }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [
        { sessionId: 'tamapal-session', timestamp: '2026-03-15T10:00:00.000Z' },
        { sessionId: 'no-channel', timestamp: '2026-03-15T10:00:00.000Z', content: noChannelContent },
      ],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir,
      channels: ['tamapal'],
      yes: true,
    });

    // Only the tamapal session should be imported
    expect(result.sessionsImported).toBe(1);
  });

  test('respects --since filter', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [
        { sessionId: 'old-session', timestamp: '2026-03-10T10:00:00.000Z' },
        { sessionId: 'new-session', timestamp: '2026-03-16T10:00:00.000Z' },
      ],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir,
      since: '2026-03-15',
      yes: true,
    });

    // Only the new session should be imported
    expect(result.sessionsImported).toBe(1);
  });

  test('detects duplicates and skips', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'dup-session', timestamp: '2026-03-15T10:00:00.000Z' }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    // Import once
    const result1 = await importOpenClaw(config, { openclawDir, yes: true });
    expect(result1.episodesCreated).toBe(1);

    // Import again — should detect duplicate
    const result2 = await importOpenClaw(config, { openclawDir, yes: true });
    expect(result2.episodesCreated).toBe(0);
    expect(result2.sessionsAlreadyImported).toBe(1);
  });

  test('handles missing openclaw directory gracefully', async () => {
    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    const result = await importOpenClaw(config, {
      openclawDir: join(tempDir, 'nonexistent-openclaw'),
      yes: true,
    });

    expect(result.sessionsScanned).toBe(0);
    expect(result.episodesCreated).toBe(0);
  });
});

// ─── SECURITY tests ─────────────────────────────────────────────────

describe('Security — credential redaction', () => {
  test('import NEVER stores raw API keys', async () => {
    const sessionId = 'security-api-keys';
    const timestamp = '2026-03-15T10:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp }),
      JSON.stringify({
        type: 'message', id: 'm1', timestamp,
        message: { role: 'user', content: 'My API key is sk-abc123def456ghi789jkl01234 please save it' },
      }),
      JSON.stringify({
        type: 'message', id: 'm2', timestamp,
        message: { role: 'assistant', content: 'I see your key sk-abc123def456ghi789jkl01234, I will not store it' },
      }),
      JSON.stringify({
        type: 'message', id: 'm3', timestamp,
        message: { role: 'user', content: 'Also npm_abcdefghijklmnopqrstuvwxyz' },
      }),
      JSON.stringify({
        type: 'message', id: 'm4', timestamp,
        message: { role: 'assistant', content: 'Noted the npm token' },
      }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId, timestamp, content: lines }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    await importOpenClaw(config, { openclawDir, yes: true });

    // Read the episode from DB and verify no raw keys
    const db = initDatabase(join(tempDir, 'memories.db'));
    const rows = db.query('SELECT transcript, summary FROM episodes').all() as { transcript: string; summary: string }[];
    closeDatabase();

    for (const row of rows) {
      expect(row.transcript).not.toContain('sk-abc123');
      expect(row.transcript).not.toContain('npm_abc');
      expect(row.transcript).toContain('[REDACTED_API_KEY]');
      expect(row.summary).not.toContain('sk-abc123');
    }
  });

  test('import NEVER stores OAT tokens', async () => {
    const sessionId = 'security-oat';
    const timestamp = '2026-03-15T10:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp }),
      JSON.stringify({
        type: 'message', id: 'm1', timestamp,
        message: { role: 'user', content: 'Token: sk-ant-oat-abc123def456ghi789jkl_mn-op' },
      }),
      JSON.stringify({
        type: 'message', id: 'm2', timestamp,
        message: { role: 'assistant', content: 'Got it' },
      }),
      JSON.stringify({
        type: 'message', id: 'm3', timestamp,
        message: { role: 'user', content: 'And Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
      }),
      JSON.stringify({
        type: 'message', id: 'm4', timestamp,
        message: { role: 'assistant', content: 'Understood' },
      }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId, timestamp, content: lines }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    await importOpenClaw(config, { openclawDir, yes: true });

    const db = initDatabase(join(tempDir, 'memories.db'));
    const rows = db.query('SELECT transcript FROM episodes').all() as { transcript: string }[];
    closeDatabase();

    for (const row of rows) {
      expect(row.transcript).not.toContain('sk-ant-oat');
      expect(row.transcript).not.toContain('eyJhbGci');
      expect(row.transcript).toContain('[REDACTED_TOKEN]');
      expect(row.transcript).toContain('Bearer [REDACTED]');
    }
  });

  test('imported episodes do not contain metadata blocks', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'security-metadata', timestamp: '2026-03-15T10:00:00.000Z' }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    await importOpenClaw(config, { openclawDir, yes: true });

    const db = initDatabase(join(tempDir, 'memories.db'));
    const rows = db.query('SELECT transcript FROM episodes').all() as { transcript: string }[];
    closeDatabase();

    for (const row of rows) {
      expect(row.transcript).not.toContain('untrusted metadata');
      expect(row.transcript).not.toContain('Conversation info');
      expect(row.transcript).not.toContain('Sender (untrusted');
      expect(row.transcript).not.toContain('group_channel');
    }
  });

  test('sanitization runs on EVERY imported message', async () => {
    const sessionId = 'security-all-messages';
    const timestamp = '2026-03-15T10:00:00.000Z';
    const lines = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp }),
      JSON.stringify({
        type: 'message', id: 'm1', timestamp,
        message: { role: 'user', content: `${METADATA_BLOCK.replace('What should we build today?', 'Message with key sk-abc123def456ghi789jkl01234')}` },
      }),
      JSON.stringify({
        type: 'message', id: 'm2', timestamp,
        message: { role: 'assistant', content: 'Reply with Bearer longTokenValueHere1234567890abcdef' },
      }),
      JSON.stringify({
        type: 'message', id: 'm3', timestamp,
        message: { role: 'user', content: 'npm_abcdefghijklmnopqrstuvwxyz is my token' },
      }),
      JSON.stringify({
        type: 'message', id: 'm4', timestamp,
        message: { role: 'assistant', content: 'All tokens received' },
      }),
    ].join('\n');

    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId, timestamp, content: lines }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    await importOpenClaw(config, { openclawDir, yes: true });

    const db = initDatabase(join(tempDir, 'memories.db'));
    const rows = db.query('SELECT transcript FROM episodes').all() as { transcript: string }[];
    closeDatabase();

    for (const row of rows) {
      // Check ALL sensitive patterns are gone
      expect(row.transcript).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
      expect(row.transcript).not.toMatch(/sk-ant-oat/);
      expect(row.transcript).not.toMatch(/npm_[a-zA-Z0-9]{20,}/);
      // Metadata should be stripped
      expect(row.transcript).not.toContain('untrusted metadata');
    }
  });

  test('toolResult messages are NEVER imported', async () => {
    const openclawDir = createTestOpenClawDir(tempDir, {
      zoro: [{ sessionId: 'security-no-tools', timestamp: '2026-03-15T10:00:00.000Z' }],
    });

    const config = getTestConfig();
    initDatabase(join(tempDir, 'memories.db'));
    closeDatabase();

    await importOpenClaw(config, { openclawDir, yes: true });

    const db = initDatabase(join(tempDir, 'memories.db'));
    const rows = db.query('SELECT transcript FROM episodes').all() as { transcript: string }[];
    closeDatabase();

    for (const row of rows) {
      expect(row.transcript).not.toContain('some tool output');
      expect(row.transcript).not.toContain('toolResult');
    }
  });
});
