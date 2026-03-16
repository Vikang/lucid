import { describe, test, expect } from 'bun:test';
import { parseLlmResponse, curateTranscript } from '../src/core/curator';
import type { Config } from '../src/storage/schema';
import { ProviderError, ApiKeyError } from '../src/utils/errors';

const mockConfig: Config = {
  dataDir: '/tmp/lucid-test',
  embedding: { provider: 'mock', model: 'mock' },
  llm: { provider: 'mock', model: 'mock' },
  version: '0.1.0',
};

describe('parseLlmResponse', () => {
  test('handles valid JSON array', () => {
    const input = JSON.stringify([
      {
        content: 'User prefers dark mode',
        importance: 0.8,
        tags: ['preference'],
        contextType: 'LEARNED_PREFERENCE',
        triggerPhrases: ['dark mode'],
        temporalRelevance: 'persistent',
      },
    ]);

    const result = parseLlmResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('User prefers dark mode');
    expect(result[0].importance).toBe(0.8);
    expect(result[0].tags).toEqual(['preference']);
  });

  test('handles JSON wrapped in markdown fences', () => {
    const input = '```json\n' + JSON.stringify([
      { content: 'Test memory', importance: 0.5 },
    ]) + '\n```';

    const result = parseLlmResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Test memory');
  });

  test('handles plain ``` fences', () => {
    const input = '```\n' + JSON.stringify([
      { content: 'Another memory', importance: 0.6 },
    ]) + '\n```';

    const result = parseLlmResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Another memory');
  });

  test('rejects non-array JSON', () => {
    const input = JSON.stringify({ content: 'not an array' });
    expect(() => parseLlmResponse(input)).toThrow('not a JSON array');
  });

  test('rejects invalid JSON', () => {
    expect(() => parseLlmResponse('not json at all')).toThrow('Failed to parse');
  });

  test('skips entries with missing content', () => {
    const input = JSON.stringify([
      { content: '', importance: 0.5 },
      { importance: 0.5 },
      { content: 'Valid memory', importance: 0.7 },
    ]);

    const result = parseLlmResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe('Valid memory');
  });

  test('rejects importance out of range', () => {
    const input = JSON.stringify([
      { content: 'Bad importance', importance: 1.5 },
    ]);
    expect(() => parseLlmResponse(input)).toThrow('Invalid importance');
  });

  test('defaults optional fields', () => {
    const input = JSON.stringify([
      { content: 'Minimal memory' },
    ]);

    const result = parseLlmResponse(input);
    expect(result).toHaveLength(1);
    expect(result[0].importance).toBe(0.5);
    expect(result[0].tags).toEqual([]);
    expect(result[0].contextType).toBe('PROJECT_CONTEXT');
    expect(result[0].temporalRelevance).toBe('persistent');
  });
});

describe('curateTranscript', () => {
  test('throws ProviderError for unsupported provider', async () => {
    const badConfig: Config = {
      ...mockConfig,
      llm: { provider: 'unsupported', model: 'whatever' },
    };

    await expect(curateTranscript('test transcript', badConfig)).rejects.toBeInstanceOf(ProviderError);
  });

  test('throws ApiKeyError when anthropic key not set', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const anthropicConfig: Config = {
      ...mockConfig,
      llm: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    };

    try {
      await expect(curateTranscript('test', anthropicConfig)).rejects.toBeInstanceOf(ApiKeyError);
    } finally {
      if (origKey) process.env.ANTHROPIC_API_KEY = origKey;
    }
  });

  test('throws ApiKeyError when openai key not set', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const openaiConfig: Config = {
      ...mockConfig,
      llm: { provider: 'openai', model: 'gpt-4o' },
    };

    try {
      await expect(curateTranscript('test', openaiConfig)).rejects.toBeInstanceOf(ApiKeyError);
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });

  test('throws ApiKeyError when gemini key not set', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const geminiConfig: Config = {
      ...mockConfig,
      llm: { provider: 'gemini', model: 'gemini-2.0-flash' },
    };

    try {
      await expect(curateTranscript('test', geminiConfig)).rejects.toBeInstanceOf(ApiKeyError);
    } finally {
      if (origKey) process.env.GEMINI_API_KEY = origKey;
    }
  });

  test('mock provider returns deterministic results', async () => {
    const result = await curateTranscript('Hello world transcript', mockConfig);
    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('Mock memory');
    expect(result[0].tags).toEqual(['mock', 'test']);
  });
});
