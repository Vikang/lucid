/**
 * Embedding generation — local (transformers.js), OpenAI, Gemini, or mock provider.
 *
 * Default: local embeddings via @huggingface/transformers (no API key needed).
 * The local pipeline is cached as a singleton for performance.
 */

import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { ApiKeyError, ProviderError } from '../utils/errors';
import type { Config } from '../storage/schema';

let openaiClient: OpenAI | null = null;

/** Singleton cache for the local transformers.js pipeline. */
let pipelineInstance: unknown = null;

/**
 * Get or create the local embedding pipeline (singleton).
 * Model downloads lazily on first call (~80MB).
 */
async function getLocalPipeline(): Promise<unknown> {
  if (pipelineInstance) return pipelineInstance;

  logger.debug('Loading local embedding model (Xenova/all-MiniLM-L6-v2)...');
  const { pipeline } = await import('@huggingface/transformers');
  pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  logger.debug('Local embedding model loaded');
  return pipelineInstance;
}

/**
 * Generate an embedding via local transformers.js pipeline.
 * Returns a 384-dim normalized vector.
 */
async function embedLocal(text: string): Promise<number[]> {
  const extractor = await getLocalPipeline() as (text: string, options: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>;
  const result = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(result.data);
}

/**
 * Get or create the OpenAI client.
 */
function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'Set OPENAI_API_KEY environment variable or configure a local embedding provider.\n' +
      'Get an API key at https://platform.openai.com/api-keys',
    );
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Generate an embedding via OpenAI.
 */
async function embedOpenAI(text: string, model: string): Promise<number[]> {
  const client = getOpenAIClient();
  const response = await client.embeddings.create({ model, input: text });
  return response.data[0].embedding;
}

/**
 * Generate an embedding via Google Gemini.
 */
async function embedGemini(text: string, model: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'Set GEMINI_API_KEY environment variable for Gemini embeddings.\n' +
      'Get an API key at https://aistudio.google.com/app/apikey',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const embeddingModel = genAI.getGenerativeModel({ model });
  const result = await embeddingModel.embedContent(text);
  return result.embedding.values;
}

/**
 * Deterministic mock embedding for testing.
 * Returns a 384-dim vector (matching local model dimensions) derived from
 * a simple hash of the text so identical texts always produce identical
 * vectors, but different texts produce different vectors.
 */
function embedMock(text: string): number[] {
  const dim = 384;
  // Simple hash: sum char codes with position weighting
  let seed = 0;
  for (let i = 0; i < text.length; i++) {
    seed = ((seed << 5) - seed + text.charCodeAt(i)) | 0;
  }
  return Array.from({ length: dim }, (_, i) => Math.sin(seed + i) * 0.1);
}

/**
 * Generate an embedding vector for the given text.
 */
export async function embed(text: string, config: Config): Promise<number[]> {
  logger.debug(`Generating embedding for text (${text.length} chars)`);

  const provider = config.embedding.provider;

  if (provider === 'local') {
    return embedLocal(text);
  }
  if (provider === 'openai') {
    return embedOpenAI(text, config.embedding.model);
  }
  if (provider === 'gemini') {
    return embedGemini(text, config.embedding.model);
  }
  if (provider === 'mock') {
    return embedMock(text);
  }

  throw new ProviderError(
    `Unsupported embedding provider: "${provider}". ` +
    'Supported providers: "local", "openai", "gemini".',
  );
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[], config: Config): Promise<number[][]> {
  logger.debug(`Generating embeddings for ${texts.length} texts`);

  if (texts.length === 0) return [];

  const provider = config.embedding.provider;

  if (provider === 'local') {
    // Process sequentially with the singleton pipeline
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedLocal(text));
    }
    return results;
  }

  if (provider === 'openai') {
    const client = getOpenAIClient();
    const response = await client.embeddings.create({
      model: config.embedding.model,
      input: texts,
    });
    return response.data
      .sort((a, b) => a.index - b.index)
      .map((d) => d.embedding);
  }

  if (provider === 'gemini') {
    // Gemini doesn't have a native batch API — loop sequentially
    const results: number[][] = [];
    for (const text of texts) {
      results.push(await embedGemini(text, config.embedding.model));
    }
    return results;
  }

  if (provider === 'mock') {
    return texts.map((t) => embedMock(t));
  }

  throw new ProviderError(
    `Unsupported embedding provider: "${provider}". ` +
    'Supported providers: "local", "openai", "gemini".',
  );
}
