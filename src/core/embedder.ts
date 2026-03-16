/**
 * Embedding generation via OpenAI API.
 *
 * Generates vector embeddings for text using OpenAI's embedding models.
 * Local provider support is planned for a future version.
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger';
import type { Config } from '../storage/schema';

let openaiClient: OpenAI | null = null;

/**
 * Get or create the OpenAI client.
 */
function getOpenAIClient(): OpenAI {
  if (openaiClient) return openaiClient;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Set OPENAI_API_KEY environment variable or configure a local embedding provider.\n' +
      'Get an API key at https://platform.openai.com/api-keys',
    );
  }

  openaiClient = new OpenAI({ apiKey });
  return openaiClient;
}

/**
 * Generate an embedding vector for the given text.
 */
export async function embed(text: string, config: Config): Promise<number[]> {
  logger.debug(`Generating embedding for text (${text.length} chars)`);

  if (config.embedding.provider !== 'openai') {
    throw new Error(
      `Unsupported embedding provider: ${config.embedding.provider}. ` +
      'Only "openai" is supported in v0.1. Local providers coming soon.',
    );
  }

  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: config.embedding.model,
    input: text,
  });

  return response.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function embedBatch(texts: string[], config: Config): Promise<number[][]> {
  logger.debug(`Generating embeddings for ${texts.length} texts`);

  if (texts.length === 0) return [];

  if (config.embedding.provider !== 'openai') {
    throw new Error(
      `Unsupported embedding provider: ${config.embedding.provider}. ` +
      'Only "openai" is supported in v0.1. Local providers coming soon.',
    );
  }

  const client = getOpenAIClient();
  const response = await client.embeddings.create({
    model: config.embedding.model,
    input: texts,
  });

  // OpenAI returns embeddings in the same order as input
  return response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}
