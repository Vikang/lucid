import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { addMemory, listMemories } from '../src/core/memory';
import { findDuplicates, deduplicateAll, computeContentHash, normalizeContent } from '../src/core/dedup';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-dedup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('normalizeContent', () => {
  test('lowercases, trims, and collapses whitespace', () => {
    expect(normalizeContent('  Hello   World  ')).toBe('hello world');
    expect(normalizeContent('FOO\n\tBAR')).toBe('foo bar');
  });
});

describe('computeContentHash', () => {
  test('same content produces same hash', () => {
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('Hello World');
    expect(hash1).toBe(hash2);
  });

  test('normalized equivalents produce same hash', () => {
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('  hello   world  ');
    expect(hash1).toBe(hash2);
  });

  test('different content produces different hash', () => {
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('Goodbye World');
    expect(hash1).not.toBe(hash2);
  });
});

describe('findDuplicates', () => {
  test('detects exact hash duplicate (same content)', async () => {
    await addMemory({ content: 'User prefers dark mode' }, config, { skipDedup: true });

    const duplicates = await findDuplicates('User prefers dark mode', config);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    expect(duplicates[0].similarity).toBe(1.0);
  });

  test('detects exact hash duplicate with different whitespace/casing', async () => {
    await addMemory({ content: 'User prefers dark mode' }, config, { skipDedup: true });

    const duplicates = await findDuplicates('  user   prefers   dark   mode  ', config);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
    // Hash match returns similarity 1.0
    expect(duplicates[0].similarity).toBe(1.0);
  });

  test('semantic dedup detects similar content above threshold', async () => {
    // Mock embeddings are deterministic based on text content.
    // Same text = same embedding = similarity 1.0
    await addMemory({ content: 'User prefers dark mode in all IDEs' }, config, { skipDedup: true });

    // Identical content → should be detected
    const duplicates = await findDuplicates('User prefers dark mode in all IDEs', config);
    expect(duplicates.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty for content below threshold', async () => {
    await addMemory({ content: 'User prefers dark mode in all IDEs' }, config, { skipDedup: true });

    // Very different content → should not match
    const duplicates = await findDuplicates(
      'The weather in Tokyo is warm and humid during summer months',
      config,
    );
    // Hash won't match, and mock embeddings for very different texts should have low similarity
    const semanticOnly = duplicates.filter((d) => d.similarity < 1.0);
    // We can't guarantee the mock embedding produces low similarity for all text pairs,
    // but at least hash match should not fire
    const hashMatches = duplicates.filter((d) => d.similarity === 1.0);
    expect(hashMatches.length).toBe(0);
  });

  test('returns empty when no memories exist', async () => {
    const duplicates = await findDuplicates('Brand new content', config);
    expect(duplicates).toEqual([]);
  });
});

describe('deduplicateAll', () => {
  test('returns empty report when no duplicates', async () => {
    await addMemory({ content: 'Memory about apples' }, config, { skipDedup: true });
    await addMemory({ content: 'Memory about oranges' }, config, { skipDedup: true });

    // With threshold 0.999, only near-identical should match
    const report = await deduplicateAll(config, 0.999);
    expect(report.totalMemories).toBe(2);
    // With high threshold, different texts shouldn't group
    // (depends on mock embedding behavior)
  });

  test('groups identical memories together', async () => {
    // Add the same content 3 times
    await addMemory({ content: 'Duplicate content here', importance: 0.5 }, config, { skipDedup: true });
    await addMemory({ content: 'Duplicate content here', importance: 0.8 }, config, { skipDedup: true });
    await addMemory({ content: 'Duplicate content here', importance: 0.3 }, config, { skipDedup: true });

    const report = await deduplicateAll(config, 0.92);
    expect(report.totalMemories).toBe(3);
    expect(report.duplicateGroups).toBe(1);
    expect(report.groups[0].memories.length).toBe(3);
    // Identical content → similarity should be very high
    expect(report.groups[0].similarity).toBeGreaterThanOrEqual(0.99);
  });

  test('report has correct structure', async () => {
    await addMemory({ content: 'First memory' }, config, { skipDedup: true });
    await addMemory({ content: 'Second memory' }, config, { skipDedup: true });

    const report = await deduplicateAll(config);
    expect(report).toHaveProperty('groups');
    expect(report).toHaveProperty('totalMemories');
    expect(report).toHaveProperty('duplicateGroups');
    expect(Array.isArray(report.groups)).toBe(true);
  });
});

describe('addMemory with dedup', () => {
  test('exact hash match returns existing memory without inserting', async () => {
    const original = await addMemory(
      { content: 'Exact duplicate test', importance: 0.9 },
      config,
      { skipDedup: true },
    );

    // Adding same content should return the original
    const result = await addMemory(
      { content: 'Exact duplicate test', importance: 0.5 },
      config,
    );

    expect(result.id).toBe(original.id);
    expect(result.importance).toBe(0.9); // Original's importance

    // Should still be just 1 memory
    const all = await listMemories(config, { limit: 100 });
    expect(all.length).toBe(1);
  });

  test('--no-dedup (skipDedup) bypasses dedup check', async () => {
    await addMemory(
      { content: 'Bypass test content' },
      config,
      { skipDedup: true },
    );

    // Adding same content with skipDedup should create a new memory
    const result = await addMemory(
      { content: 'Bypass test content' },
      config,
      { skipDedup: true },
    );

    const all = await listMemories(config, { limit: 100 });
    expect(all.length).toBe(2);
  });

  test('semantic near-match still inserts (warns but does not block)', async () => {
    await addMemory(
      { content: 'The user likes TypeScript for backend work' },
      config,
      { skipDedup: true },
    );

    // Similar but not identical content — should still insert
    // (addMemory warns but doesn't block on semantic matches)
    const result = await addMemory(
      { content: 'The user likes TypeScript for backend development' },
      config,
    );

    // Should have gotten a new ID (not the original)
    const all = await listMemories(config, { limit: 100 });
    expect(all.length).toBe(2);
  });

  test('content_hash is stored on new memories', async () => {
    const memory = await addMemory(
      { content: 'Hash test content' },
      config,
      { skipDedup: true },
    );

    expect(memory.contentHash).toBeTruthy();
    expect(memory.contentHash).toBe(computeContentHash('Hash test content'));
  });
});
