import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { addMemory, getMemory, deleteMemory, listMemories } from '../src/core/memory';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

// Mock the embedder to avoid real API calls
mock.module('../src/core/embedder', () => ({
  embed: async () => Array(1536).fill(0).map((_, i) => Math.sin(i) * 0.1),
  embedBatch: async (texts: string[]) => texts.map(() => Array(1536).fill(0).map((_, i) => Math.sin(i) * 0.1)),
}));

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  return {
    dataDir: tmpDir,
    embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    version: '0.1.0',
  };
}

beforeEach(() => {
  config = freshConfig();
});

afterEach(() => {
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // cleanup best effort
  }
});

describe('addMemory', () => {
  test('creates a memory with all fields', async () => {
    const memory = await addMemory({
      content: 'User prefers dark mode in all IDEs',
      importance: 0.8,
      tags: ['preference', 'ide'],
      contextType: 'LEARNED_PREFERENCE',
      triggerPhrases: ['dark mode', 'IDE theme'],
      temporalRelevance: 'persistent',
    }, config);

    expect(memory.id).toBeTruthy();
    expect(memory.content).toBe('User prefers dark mode in all IDEs');
    expect(memory.importance).toBe(0.8);
    expect(memory.tags).toEqual(['preference', 'ide']);
    expect(memory.contextType).toBe('LEARNED_PREFERENCE');
    expect(memory.triggerPhrases).toEqual(['dark mode', 'IDE theme']);
    expect(memory.temporalRelevance).toBe('persistent');
    expect(memory.createdAt).toBeTruthy();
    expect(memory.accessCount).toBe(0);
  });

  test('uses defaults for optional fields', async () => {
    const memory = await addMemory({
      content: 'Simple memory with defaults',
    }, config);

    expect(memory.importance).toBe(0.5);
    expect(memory.tags).toEqual([]);
    expect(memory.contextType).toBe('PROJECT_CONTEXT');
    expect(memory.temporalRelevance).toBe('persistent');
  });
});

describe('getMemory', () => {
  test('retrieves a stored memory by ID', async () => {
    const created = await addMemory({
      content: 'Test memory for retrieval',
      tags: ['test'],
    }, config);

    const retrieved = await getMemory(created.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.content).toBe('Test memory for retrieval');
    expect(retrieved!.tags).toEqual(['test']);
  });

  test('returns null for non-existent ID', async () => {
    // Need to init DB first by adding something
    await addMemory({ content: 'init' }, config);
    const result = await getMemory('non-existent-id', config);
    expect(result).toBeNull();
  });
});

describe('deleteMemory', () => {
  test('deletes an existing memory', async () => {
    const memory = await addMemory({
      content: 'Memory to delete',
      tags: ['delete-me'],
    }, config);

    const deleted = await deleteMemory(memory.id, config);
    expect(deleted).toBe(true);

    const retrieved = await getMemory(memory.id, config);
    expect(retrieved).toBeNull();
  });

  test('returns false for non-existent ID', async () => {
    // Need to init DB
    await addMemory({ content: 'init' }, config);
    const deleted = await deleteMemory('non-existent-id', config);
    expect(deleted).toBe(false);
  });
});

describe('listMemories', () => {
  test('lists all memories sorted by created_at desc', async () => {
    await addMemory({ content: 'First memory' }, config);
    await addMemory({ content: 'Second memory' }, config);
    await addMemory({ content: 'Third memory' }, config);

    const memories = await listMemories(config);
    expect(memories.length).toBe(3);
    // Most recent first
    expect(memories[0].content).toBe('Third memory');
  });

  test('filters by tag', async () => {
    await addMemory({ content: 'Tagged memory', tags: ['important'] }, config);
    await addMemory({ content: 'Untagged memory' }, config);

    const filtered = await listMemories(config, { tag: 'important' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].content).toBe('Tagged memory');
  });

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await addMemory({ content: `Memory ${i}` }, config);
    }

    const limited = await listMemories(config, { limit: 3 });
    expect(limited.length).toBe(3);
  });

  test('returns empty array when no memories exist', async () => {
    // Initialize DB by calling list on a fresh config
    const memories = await listMemories(config);
    expect(memories).toEqual([]);
  });
});
