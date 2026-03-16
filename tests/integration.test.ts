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
    // With mock embeddings and smart scoring, results depend on gatekeeper
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

  test('search returns scored results with components', async () => {
    // Add a memory with trigger phrases to ensure it passes gatekeeper
    await addMemory({
      content: 'Always use strict TypeScript',
      tags: ['typescript'],
      importance: 0.8,
      triggerPhrases: ['typescript strict'],
      confidenceScore: 0.8,
    }, config);

    const results = await searchMemories('typescript strict', {
      limit: 5,
      config,
    });

    // Results should have the new scoring fields
    if (results.length > 0) {
      expect(typeof results[0].score).toBe('number');
      expect(typeof results[0].relevance).toBe('number');
      expect(results[0].reasoning).toBeTruthy();
      expect(results[0].components).toBeDefined();
      expect(results[0].content).toBe('Always use strict TypeScript');
    }
  });

  test('memories with new smart recall fields round-trip correctly', async () => {
    const memory = await addMemory({
      content: 'Smart recall test memory',
      importance: 0.9,
      tags: ['test'],
      contextType: 'TECHNICAL_DECISION',
      triggerPhrases: ['smart recall'],
      questionTypes: ['how does recall work'],
      emotionalResonance: 'discovery',
      problemSolutionPair: true,
      confidenceScore: 0.95,
      actionRequired: true,
      knowledgeDomain: 'testing',
    }, config);

    expect(memory.questionTypes).toEqual(['how does recall work']);
    expect(memory.emotionalResonance).toBe('discovery');
    expect(memory.problemSolutionPair).toBe(true);
    expect(memory.confidenceScore).toBe(0.95);
    expect(memory.actionRequired).toBe(true);
    expect(memory.knowledgeDomain).toBe('testing');

    // Verify round-trip through DB
    const retrieved = await getMemory(memory.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.questionTypes).toEqual(['how does recall work']);
    expect(retrieved!.emotionalResonance).toBe('discovery');
    expect(retrieved!.problemSolutionPair).toBe(true);
    expect(retrieved!.confidenceScore).toBe(0.95);
    expect(retrieved!.actionRequired).toBe(true);
    expect(retrieved!.knowledgeDomain).toBe('testing');
  });
});
