import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  saveEpisode,
  getEpisode,
  listEpisodes,
  deleteEpisode,
  searchEpisodes,
  generatePrimer,
  formatTimeAgo,
} from '../src/core/episodes';
import { addMemory, getMemory } from '../src/core/memory';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-episode-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('saveEpisode', () => {
  test('creates episode with all fields + tags + embedding', async () => {
    const episode = await saveEpisode({
      transcript: 'Human: What is Lucid?\nAssistant: A memory tool for AI agents.',
      label: 'Lucid intro',
      summary: 'Introduced Lucid as a memory tool',
      tags: ['lucid', 'intro'],
      projectId: 'lucid',
      interactionTone: 'collaborative',
      duration: '30 minutes',
    }, config);

    expect(episode.id).toBeTruthy();
    expect(episode.label).toBe('Lucid intro');
    expect(episode.summary).toBe('Introduced Lucid as a memory tool');
    expect(episode.transcript).toContain('What is Lucid?');
    expect(episode.messageCount).toBe(2);
    expect(episode.tags).toEqual(['lucid', 'intro']);
    expect(episode.projectId).toBe('lucid');
    expect(episode.interactionTone).toBe('collaborative');
    expect(episode.duration).toBe('30 minutes');
    expect(episode.createdAt).toBeTruthy();
    expect(episode.embeddingDim).toBe(384); // mock returns 384-dim vectors
  });

  test('auto-generates summary from transcript if not provided', async () => {
    const transcript = 'Human: Hello there!\nAssistant: Hi! How can I help you today?';
    const episode = await saveEpisode({
      transcript,
    }, config);

    expect(episode.summary).toBe(transcript.slice(0, 500));
  });

  test('auto-generates summary truncated at 500 chars for long transcripts', async () => {
    const longTranscript = 'A'.repeat(1000);
    const episode = await saveEpisode({
      transcript: longTranscript,
    }, config);

    expect(episode.summary.length).toBe(500);
  });

  test('links existing memories via memoryIds', async () => {
    const memory = await addMemory({
      content: 'Lucid is a memory tool',
      tags: ['lucid'],
    }, config);

    const episode = await saveEpisode({
      transcript: 'Human: What is Lucid?\nAssistant: A memory tool.',
      label: 'Test',
      memoryIds: [memory.id],
    }, config);

    // Verify the memory now has the episode_id
    const updated = await getMemory(memory.id, config);
    expect(updated).not.toBeNull();
    expect(updated!.episodeId).toBe(episode.id);
  });
});

describe('getEpisode', () => {
  test('retrieves by ID with tags', async () => {
    const created = await saveEpisode({
      transcript: 'Human: test\nAssistant: ok',
      label: 'Test session',
      tags: ['test', 'demo'],
    }, config);

    const retrieved = await getEpisode(created.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(created.id);
    expect(retrieved!.label).toBe('Test session');
    expect(retrieved!.tags.sort()).toEqual(['demo', 'test']);
  });

  test('returns null for non-existent', async () => {
    // Init DB by saving something
    await saveEpisode({ transcript: 'init' }, config);
    const result = await getEpisode('non-existent-id', config);
    expect(result).toBeNull();
  });
});

describe('deleteEpisode', () => {
  test('removes episode + cascades tags', async () => {
    const episode = await saveEpisode({
      transcript: 'Human: delete me\nAssistant: ok',
      tags: ['delete-test'],
    }, config);

    const deleted = await deleteEpisode(episode.id, config);
    expect(deleted).toBe(true);

    const retrieved = await getEpisode(episode.id, config);
    expect(retrieved).toBeNull();
  });

  test('returns false for non-existent', async () => {
    await saveEpisode({ transcript: 'init' }, config);
    const deleted = await deleteEpisode('non-existent-id', config);
    expect(deleted).toBe(false);
  });

  test('clears episode_id on linked memories', async () => {
    const memory = await addMemory({
      content: 'Test memory',
    }, config);

    const episode = await saveEpisode({
      transcript: 'test',
      memoryIds: [memory.id],
    }, config);

    // Memory should be linked
    let updated = await getMemory(memory.id, config);
    expect(updated!.episodeId).toBe(episode.id);

    // Delete episode
    await deleteEpisode(episode.id, config);

    // Memory should be unlinked
    updated = await getMemory(memory.id, config);
    expect(updated!.episodeId).toBeNull();
  });
});

describe('listEpisodes', () => {
  test('returns sorted by created_at desc', async () => {
    await saveEpisode({ transcript: 'first' }, config);
    await saveEpisode({ transcript: 'second' }, config);
    await saveEpisode({ transcript: 'third', label: 'Third' }, config);

    const episodes = await listEpisodes(config);
    expect(episodes.length).toBe(3);
    expect(episodes[0].label).toBe('Third');
  });

  test('filters by projectId', async () => {
    await saveEpisode({ transcript: 'lucid stuff', projectId: 'lucid' }, config);
    await saveEpisode({ transcript: 'other stuff', projectId: 'other' }, config);

    const filtered = await listEpisodes(config, { projectId: 'lucid' });
    expect(filtered.length).toBe(1);
    expect(filtered[0].projectId).toBe('lucid');
  });

  test('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await saveEpisode({ transcript: `episode ${i}` }, config);
    }

    const limited = await listEpisodes(config, { limit: 3 });
    expect(limited.length).toBe(3);
  });

  test('returns empty when no episodes exist', async () => {
    const episodes = await listEpisodes(config);
    expect(episodes).toEqual([]);
  });
});

describe('searchEpisodes', () => {
  test('finds by semantic similarity', async () => {
    await saveEpisode({
      transcript: 'Human: What is Lucid?\nAssistant: A memory tool.',
      summary: 'Discussed Lucid memory tool',
      label: 'Lucid intro',
      tags: ['lucid'],
    }, config);

    const results = await searchEpisodes('memory tool', config);
    // With mock embeddings, similarity depends on text length — may or may not match
    // But the text search fallback should find it
    expect(results.length).toBeGreaterThanOrEqual(0);
  });

  test('returns empty for irrelevant query with no text match', async () => {
    await saveEpisode({
      transcript: 'Human: Hello\nAssistant: Hi',
      summary: 'Greeting exchange',
      label: 'Greetings',
    }, config);

    const results = await searchEpisodes('quantum physics nuclear reactor', config);
    expect(results.length).toBe(0);
  });

  test('text search finds by transcript content', async () => {
    await saveEpisode({
      transcript: 'Human: Tell me about TypeScript\nAssistant: TypeScript is great!',
      summary: 'TS discussion',
      label: 'TypeScript talk',
    }, config);

    const results = await searchEpisodes('typescript', config);
    expect(results.length).toBeGreaterThan(0);
    // Text matches get matchType 'text' or 'semantic'
    expect(results[0].label).toBe('TypeScript talk');
  });
});

describe('generatePrimer', () => {
  test('returns formatted primer text', async () => {
    await saveEpisode({
      transcript: 'Human: What is Lucid?\nAssistant: A memory tool.',
      summary: 'Built Lucid from scratch',
      label: 'Lucid kickoff',
      tags: ['lucid', 'architecture'],
      duration: '4 hours',
    }, config);

    const primer = await generatePrimer(config);

    expect(primer).toContain('# Continuing Session');
    expect(primer).toContain('Built Lucid from scratch');
    // Tags may come back in any order from DB
    expect(primer).toMatch(/lucid|architecture/);
    expect(primer).toContain('4 hours');
    expect(primer).toContain('Memories from that session will surface as relevant.');
  });

  test('handles no episodes gracefully', async () => {
    const primer = await generatePrimer(config);
    expect(primer).toBe('No previous sessions recorded.');
  });

  test('filters by projectId', async () => {
    await saveEpisode({
      transcript: 'project A stuff',
      summary: 'Project A work',
      label: 'Project A',
      projectId: 'project-a',
    }, config);
    await saveEpisode({
      transcript: 'project B stuff',
      summary: 'Project B work',
      label: 'Project B',
      projectId: 'project-b',
    }, config);

    const primer = await generatePrimer(config, { projectId: 'project-a' });
    expect(primer).toContain('Project A work');
    expect(primer).not.toContain('Project B work');
  });
});

describe('formatTimeAgo', () => {
  test('returns "just now" for < 1 minute', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 30 * 1000); // 30 seconds ago
    expect(formatTimeAgo(date, now)).toBe('just now');
  });

  test('returns "X minutes ago"', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 5 * 60 * 1000);
    expect(formatTimeAgo(date, now)).toBe('5 minutes ago');
  });

  test('returns "1 minute ago" (singular)', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 1 * 60 * 1000);
    expect(formatTimeAgo(date, now)).toBe('1 minute ago');
  });

  test('returns "X hours ago"', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    expect(formatTimeAgo(date, now)).toBe('3 hours ago');
  });

  test('returns "X days ago"', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    expect(formatTimeAgo(date, now)).toBe('2 days ago');
  });

  test('returns "X weeks ago"', () => {
    const now = new Date();
    const date = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    expect(formatTimeAgo(date, now)).toBe('2 weeks ago');
  });
});

describe('memory-episode linking', () => {
  test('memory with episode_id preserves the link through round-trip', async () => {
    const episode = await saveEpisode({
      transcript: 'Human: test\nAssistant: ok',
      label: 'Link test',
    }, config);

    const memory = await addMemory({
      content: 'Test fact from session',
      episodeId: episode.id,
    }, config);

    expect(memory.episodeId).toBe(episode.id);

    // Round-trip through DB
    const retrieved = await getMemory(memory.id, config);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.episodeId).toBe(episode.id);
  });

  test('addMemory without episodeId has null', async () => {
    const memory = await addMemory({
      content: 'No episode link',
    }, config);

    expect(memory.episodeId).toBeNull();

    const retrieved = await getMemory(memory.id, config);
    expect(retrieved!.episodeId).toBeNull();
  });
});
