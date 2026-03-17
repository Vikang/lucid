import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { addMemory, getMemory, deleteMemory, listMemories } from '../src/core/memory';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * Uses the built-in mock embedding provider instead of mock.module
 * so it doesn't leak into other test files.
 */

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  return {
    dataDir: tmpDir,
    embedding: { provider: 'mock', model: 'mock' },
    llm: { provider: 'mock', model: 'mock' },
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
    // Smart recall defaults
    expect(memory.questionTypes).toEqual([]);
    expect(memory.emotionalResonance).toBe('');
    expect(memory.problemSolutionPair).toBe(false);
    expect(memory.confidenceScore).toBe(0.8);
    expect(memory.actionRequired).toBe(false);
    expect(memory.knowledgeDomain).toBe('');
  });

  test('creates a memory with smart recall fields', async () => {
    const memory = await addMemory({
      content: 'Memory with smart recall metadata',
      importance: 0.9,
      questionTypes: ['how to test', 'what is testing'],
      emotionalResonance: 'discovery',
      problemSolutionPair: true,
      confidenceScore: 0.95,
      actionRequired: true,
      knowledgeDomain: 'testing',
    }, config);

    expect(memory.questionTypes).toEqual(['how to test', 'what is testing']);
    expect(memory.emotionalResonance).toBe('discovery');
    expect(memory.problemSolutionPair).toBe(true);
    expect(memory.confidenceScore).toBe(0.95);
    expect(memory.actionRequired).toBe(true);
    expect(memory.knowledgeDomain).toBe('testing');
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

  test('filters by sourceAgent with --by', async () => {
    await addMemory({ content: 'Robin memory', sourceAgent: 'robin' }, config);
    await addMemory({ content: 'Zoro memory', sourceAgent: 'zoro' }, config);
    await addMemory({ content: 'No agent memory' }, config);

    const robinOnly = await listMemories(config, { sourceAgent: 'robin' });
    expect(robinOnly.length).toBe(1);
    expect(robinOnly[0].content).toBe('Robin memory');
    expect(robinOnly[0].sourceAgent).toBe('robin');

    const zoroOnly = await listMemories(config, { sourceAgent: 'zoro' });
    expect(zoroOnly.length).toBe(1);
    expect(zoroOnly[0].content).toBe('Zoro memory');
  });

  test('filters by tag and sourceAgent combined', async () => {
    await addMemory({ content: 'Robin tagged', tags: ['lucid'], sourceAgent: 'robin' }, config);
    await addMemory({ content: 'Zoro tagged', tags: ['lucid'], sourceAgent: 'zoro' }, config);
    await addMemory({ content: 'Robin untagged', sourceAgent: 'robin' }, config);

    const filtered = await listMemories(config, { tag: 'lucid', sourceAgent: 'robin' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].content).toBe('Robin tagged');
  });
});

describe('agent attribution', () => {
  test('addMemory stores sourceAgent', async () => {
    const memory = await addMemory({
      content: 'Memory from robin',
      sourceAgent: 'robin',
    }, config);

    expect(memory.sourceAgent).toBe('robin');

    const retrieved = await getMemory(memory.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sourceAgent).toBe('robin');
  });

  test('addMemory defaults sourceAgent to null when not provided', async () => {
    const memory = await addMemory({
      content: 'Memory without agent',
    }, config);

    expect(memory.sourceAgent).toBeNull();

    const retrieved = await getMemory(memory.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.sourceAgent).toBeNull();
  });

  test('addMemory auto-detects from OPENCLAW_AGENT_ID env var', async () => {
    const originalEnv = process.env.OPENCLAW_AGENT_ID;
    try {
      process.env.OPENCLAW_AGENT_ID = 'nami';

      const memory = await addMemory({
        content: 'Memory auto-detected agent',
      }, config);

      expect(memory.sourceAgent).toBe('nami');

      const retrieved = await getMemory(memory.id, config);
      expect(retrieved!.sourceAgent).toBe('nami');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.OPENCLAW_AGENT_ID;
      } else {
        process.env.OPENCLAW_AGENT_ID = originalEnv;
      }
    }
  });

  test('explicit sourceAgent takes priority over env var', async () => {
    const originalEnv = process.env.OPENCLAW_AGENT_ID;
    try {
      process.env.OPENCLAW_AGENT_ID = 'nami';

      const memory = await addMemory({
        content: 'Explicit agent wins',
        sourceAgent: 'robin',
      }, config);

      expect(memory.sourceAgent).toBe('robin');
    } finally {
      if (originalEnv === undefined) {
        delete process.env.OPENCLAW_AGENT_ID;
      } else {
        process.env.OPENCLAW_AGENT_ID = originalEnv;
      }
    }
  });

  test('sourceAgent flows through to listMemories', async () => {
    await addMemory({ content: 'From robin', sourceAgent: 'robin' }, config);
    await addMemory({ content: 'From zoro', sourceAgent: 'zoro' }, config);
    await addMemory({ content: 'No agent' }, config);

    const all = await listMemories(config);
    expect(all.length).toBe(3);

    const robin = all.find(m => m.sourceAgent === 'robin');
    expect(robin).not.toBeUndefined();
    expect(robin!.content).toBe('From robin');

    const noAgent = all.find(m => m.sourceAgent === null);
    expect(noAgent).not.toBeUndefined();
    expect(noAgent!.content).toBe('No agent');
  });
});
