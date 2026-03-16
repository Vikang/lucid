import { describe, test, expect } from 'bun:test';
import { embed, embedBatch } from '../src/core/embedder';
import { ApiKeyError, ProviderError } from '../src/utils/errors';
import type { Config } from '../src/storage/schema';

const mockConfig: Config = {
  dataDir: '/tmp/lucid-test',
  embedding: { provider: 'mock', model: 'mock' },
  llm: { provider: 'mock', model: 'mock' },
  version: '0.1.0',
};

describe('embed', () => {
  test('throws ApiKeyError when OPENAI_API_KEY not set', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const openaiConfig: Config = {
      ...mockConfig,
      embedding: { provider: 'openai', model: 'text-embedding-3-small' },
    };

    try {
      await expect(embed('test', openaiConfig)).rejects.toBeInstanceOf(ApiKeyError);
    } finally {
      if (origKey) process.env.OPENAI_API_KEY = origKey;
    }
  });

  test('throws ApiKeyError when GEMINI_API_KEY not set', async () => {
    const origKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    const geminiConfig: Config = {
      ...mockConfig,
      embedding: { provider: 'gemini', model: 'text-embedding-004' },
    };

    try {
      await expect(embed('test', geminiConfig)).rejects.toBeInstanceOf(ApiKeyError);
    } finally {
      if (origKey) process.env.GEMINI_API_KEY = origKey;
    }
  });

  test('throws ProviderError for unsupported provider', async () => {
    const badConfig: Config = {
      ...mockConfig,
      embedding: { provider: 'unsupported', model: 'whatever' },
    };
    await expect(embed('test', badConfig)).rejects.toBeInstanceOf(ProviderError);
  });

  test('mock provider returns deterministic vector', async () => {
    const result = await embed('hello', mockConfig);
    expect(result).toHaveLength(1536);

    // Same input = same output
    const result2 = await embed('hello', mockConfig);
    expect(result).toEqual(result2);
  });

  test('mock provider returns different vectors for different text lengths', async () => {
    const v1 = await embed('short', mockConfig);
    const v2 = await embed('a longer piece of text', mockConfig);
    expect(v1).not.toEqual(v2);
  });
});

describe('embedBatch', () => {
  test('returns empty array for empty input', async () => {
    const result = await embedBatch([], mockConfig);
    expect(result).toEqual([]);
  });

  test('throws ProviderError for unsupported provider', async () => {
    const badConfig: Config = {
      ...mockConfig,
      embedding: { provider: 'unsupported', model: 'whatever' },
    };
    await expect(embedBatch(['test'], badConfig)).rejects.toBeInstanceOf(ProviderError);
  });

  test('mock provider returns correct number of vectors', async () => {
    const texts = ['hello', 'world', 'test'];
    const result = await embedBatch(texts, mockConfig);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(1536);
  });
});
