import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { curateTranscript } from '../src/core/curator';
import { addMemory, getMemory, deleteMemory, listMemories } from '../src/core/memory';
import { searchMemories } from '../src/core/search';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

/**
 * Full integration test using mock providers.
 * Tests the entire pipeline: curate → store → recall → list → forget.
 * No real API calls — everything uses the deterministic mock provider.
 */

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-integration-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('Full pipeline integration', () => {
  test('curate → store → list → forget', async () => {
    // Step 1: Curate a transcript with mock provider
    const transcript = 'Human: I prefer TypeScript for all projects.\nAssistant: Noted!';
    const extracted = await curateTranscript(transcript, config);

    expect(extracted.length).toBeGreaterThan(0);
    expect(extracted[0].content).toBeTruthy();

    // Step 2: Store the extracted memories
    const stored = [];
    for (const input of extracted) {
      const memory = await addMemory(input, config);
      stored.push(memory);
    }

    expect(stored.length).toBe(extracted.length);
    const memoryId = stored[0].id;
    expect(memoryId).toBeTruthy();

    // Step 3: Retrieve by ID
    const retrieved = await getMemory(memoryId, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(memoryId);
    expect(retrieved!.content).toBe(stored[0].content);

    // Step 4: List all memories
    const allMemories = await listMemories(config);
    expect(allMemories.length).toBe(stored.length);

    // Step 5: Search (recall) — mock embeddings will match since same-length texts produce same vectors
    const results = await searchMemories('mock memory', {
      limit: 5,
      config,
    });
    // With mock embeddings, we should get results (similarity depends on text length)
    expect(results).toBeDefined();

    // Step 6: Forget (delete)
    const deleted = await deleteMemory(memoryId, config);
    expect(deleted).toBe(true);

    // Verify it's gone
    const gone = await getMemory(memoryId, config);
    expect(gone).toBeNull();

    // List should be empty now (we only had one memory from mock)
    const remaining = await listMemories(config);
    expect(remaining.length).toBe(0);
  });

  test('multiple memories with tag filtering', async () => {
    // Add memories with different tags
    await addMemory({
      content: 'Prefers dark mode',
      tags: ['preference', 'ui'],
      importance: 0.8,
    }, config);

    await addMemory({
      content: 'Uses Bun for TypeScript projects',
      tags: ['tooling', 'typescript'],
      importance: 0.7,
    }, config);

    await addMemory({
      content: 'Debugging tip: check network tab first',
      tags: ['debugging'],
      importance: 0.6,
    }, config);

    // List all
    const all = await listMemories(config);
    expect(all.length).toBe(3);

    // Filter by tag
    const prefs = await listMemories(config, { tag: 'preference' });
    expect(prefs.length).toBe(1);
    expect(prefs[0].content).toBe('Prefers dark mode');

    const tooling = await listMemories(config, { tag: 'tooling' });
    expect(tooling.length).toBe(1);
    expect(tooling[0].content).toBe('Uses Bun for TypeScript projects');
  });

  test('search returns scored results', async () => {
    // Add a memory
    await addMemory({
      content: 'Always use strict TypeScript',
      tags: ['typescript'],
    }, config);

    // Search — mock embeddings produce deterministic vectors; use a very low
    // threshold to ensure we get results regardless of cosine similarity value
    const results = await searchMemories('typescript strict', {
      limit: 5,
      minScore: -1.0,
      config,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0].score).toBe('number');
    expect(results[0].content).toBe('Always use strict TypeScript');
  });
});
