/**
 * Transcript → memory extraction via LLM.
 *
 * Analyzes conversation transcripts and extracts structured memories
 * with importance scoring, categorization, and trigger phrases.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '../utils/logger';
import type { Config } from '../storage/schema';
import { ContextType } from '../storage/schema';
import type { AddMemoryInput } from './memory';

const CONTEXT_TYPES = Object.values(ContextType);

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the following conversation transcript and extract discrete, standalone memories that would be useful to recall in future conversations.

For each memory, extract:
- **content**: A concise, standalone statement that makes sense without the original conversation context. Write it as a fact or preference, not a quote. (1-3 sentences max)
- **importance**: A score from 0.0 to 1.0 indicating how important/useful this memory is for future recall. Higher = more important (personal preferences, key decisions, recurring patterns > casual mentions, trivial details)
- **tags**: An array of lowercase tags for categorization (e.g., ["typescript", "testing", "preference"])
- **contextType**: One of: ${CONTEXT_TYPES.join(', ')}
- **triggerPhrases**: Short phrases (2-5 words each) that should cause this memory to surface in future searches. Think about what someone might ask that this memory answers.
- **temporalRelevance**: One of: "persistent" (always relevant), "short-term" (relevant for days/weeks), "expiring" (may become outdated)

Rules:
1. Each memory must be STANDALONE — someone reading it without the conversation should understand it fully
2. Merge related details into single memories rather than creating many tiny ones
3. Skip trivial greetings, pleasantries, and small talk
4. Focus on: decisions made, preferences expressed, facts learned, patterns observed, problems solved, tools/techniques mentioned
5. Be selective — quality over quantity. 3-8 memories per conversation is typical
6. Tags should be specific and reusable (not "conversation1" but "react", "deployment", "preference")

Respond with ONLY a JSON array. No markdown code fences, no explanation. Just the raw JSON array.

Example output:
[
  {
    "content": "Prefers TypeScript strict mode with no-any rule enabled for all projects.",
    "importance": 0.8,
    "tags": ["typescript", "preference", "code-style"],
    "contextType": "LEARNED_PREFERENCE",
    "triggerPhrases": ["typescript config", "strict mode", "code style preferences"],
    "temporalRelevance": "persistent"
  }
]

Transcript to analyze:
`;

/**
 * Extract memories from a conversation transcript using an LLM.
 */
export async function curateTranscript(
  transcript: string,
  config: Config,
): Promise<AddMemoryInput[]> {
  logger.debug(`Curating transcript (${transcript.length} chars) with ${config.llm.provider}/${config.llm.model}`);

  const fullPrompt = EXTRACTION_PROMPT + transcript;
  let responseText: string;

  if (config.llm.provider === 'anthropic') {
    responseText = await callAnthropic(fullPrompt, config.llm.model);
  } else if (config.llm.provider === 'openai') {
    responseText = await callOpenAI(fullPrompt, config.llm.model);
  } else {
    throw new Error(
      `Unsupported LLM provider: ${config.llm.provider}. ` +
      'Supported providers: "anthropic", "openai".',
    );
  }

  return parseAndValidate(responseText);
}

/**
 * Call Anthropic's API for memory extraction.
 */
async function callAnthropic(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Set ANTHROPIC_API_KEY environment variable for memory curation.\n' +
      'Get an API key at https://console.anthropic.com/',
    );
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      { role: 'user', content: prompt },
    ],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic API');
  }
  return block.text;
}

/**
 * Call OpenAI's API for memory extraction.
 */
async function callOpenAI(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'Set OPENAI_API_KEY environment variable for memory curation.\n' +
      'Get an API key at https://platform.openai.com/api-keys',
    );
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    messages: [
      { role: 'user', content: prompt },
    ],
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Empty response from OpenAI API');
  }
  return content;
}

/**
 * Parse the LLM response as JSON and validate each memory entry.
 */
function parseAndValidate(responseText: string): AddMemoryInput[] {
  // Strip markdown code fences if present
  let cleaned = responseText.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(
      'Failed to parse LLM response as JSON. The model returned invalid JSON.\n' +
      `Response preview: ${cleaned.slice(0, 200)}...`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM response is not a JSON array. Expected an array of memory objects.');
  }

  const memories: AddMemoryInput[] = [];

  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;

    const record = item as Record<string, unknown>;
    const content = typeof record.content === 'string' ? record.content.trim() : '';
    if (!content) continue;

    const importance = typeof record.importance === 'number'
      ? Math.max(0, Math.min(1, record.importance))
      : 0.5;

    const tags = Array.isArray(record.tags)
      ? record.tags.filter((t): t is string => typeof t === 'string').map((t) => t.toLowerCase())
      : [];

    const contextType = typeof record.contextType === 'string' && CONTEXT_TYPES.includes(record.contextType as ContextType)
      ? record.contextType
      : 'PROJECT_CONTEXT';

    const triggerPhrases = Array.isArray(record.triggerPhrases)
      ? record.triggerPhrases.filter((t): t is string => typeof t === 'string')
      : [];

    const temporalRelevance = typeof record.temporalRelevance === 'string' &&
      ['persistent', 'short-term', 'expiring'].includes(record.temporalRelevance)
      ? record.temporalRelevance as 'persistent' | 'short-term' | 'expiring'
      : 'persistent';

    memories.push({
      content,
      importance,
      tags,
      contextType,
      triggerPhrases,
      temporalRelevance,
    });
  }

  logger.debug(`Extracted ${memories.length} memories from LLM response`);
  return memories;
}
