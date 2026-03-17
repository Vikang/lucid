/**
 * Transcript → memory extraction via LLM.
 *
 * Analyzes conversation transcripts and extracts structured memories
 * with importance scoring, categorization, and trigger phrases.
 * Supports Ollama (local), OpenAI, Anthropic, Gemini, and a deterministic mock provider.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { ApiKeyError, ProviderError, ValidationError } from '../utils/errors';
import type { Config } from '../storage/schema';
import { ContextType } from '../storage/schema';
import type { AddMemoryInput } from './memory';

const CONTEXT_TYPES = Object.values(ContextType);

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the following conversation transcript and extract discrete, standalone memories that would be useful to recall in future conversations.

Focus on capturing the REASONING behind decisions, not just the outcomes. The most valuable memories explain WHY something was chosen, what alternatives were considered, what went wrong, and what was learned.

For each memory, extract:
- **content**: A concise, standalone statement that makes sense without the original conversation context. Write it as a fact, decision, or lesson — not a quote. Include the reasoning or context that makes it actionable. (1-3 sentences max)
- **importance**: A score from 0.0 to 1.0 indicating how important/useful this memory is for future recall. Higher = more important (key decisions with rationale, hard-won lessons, recurring patterns > casual mentions, trivial details)
- **tags**: An array of lowercase tags for categorization (e.g., ["typescript", "testing", "preference"])
- **contextType**: One of: ${CONTEXT_TYPES.join(', ')}
- **triggerPhrases**: Short phrases (2-5 words each) that should cause this memory to surface in future searches. Think about what someone might ask that this memory answers.
- **temporalRelevance**: One of: "persistent" (always relevant), "short-term" (relevant for days/weeks), "expiring" (may become outdated)
- **metadata**: An optional object with structured context about the memory. Include only the fields that are relevant:
  - **decision_rationale**: Why this decision was made — the core reasoning
  - **alternatives_considered**: Other options that were evaluated and why they were rejected
  - **blockers**: Problems encountered and how they were resolved
  - **lessons_learned**: Things that were surprising, counter-intuitive, or worth remembering for next time

Rules:
1. Each memory must be STANDALONE — someone reading it without the conversation should understand it fully
2. Merge related details into single memories rather than creating many tiny ones
3. Skip trivial greetings, pleasantries, and small talk
4. Focus on: WHY decisions were made (not just WHAT), trade-offs considered, blockers and resolutions, lessons learned, preferences expressed, patterns observed
5. Be selective — quality over quantity. 3-8 memories per conversation is typical
6. Tags should be specific and reusable (not "conversation1" but "react", "deployment", "preference")
7. The metadata field is optional — omit it entirely for simple facts/preferences that don't involve decisions or trade-offs

Respond with ONLY a JSON array. No markdown code fences, no explanation. Just the raw JSON array.

Example output:
[
  {
    "content": "Chose Bun over Node.js as the runtime for Lucid because it has built-in SQLite, TypeScript support, and faster startup times for CLI tools.",
    "importance": 0.9,
    "tags": ["bun", "runtime", "technical-decision", "lucid"],
    "contextType": "TECHNICAL_DECISION",
    "triggerPhrases": ["why bun", "runtime choice", "bun vs node"],
    "temporalRelevance": "persistent",
    "metadata": {
      "decision_rationale": "Needed native SQLite and TypeScript without transpilation. Bun bundles both and has sub-100ms startup which matters for CLI tools.",
      "alternatives_considered": "Node.js with better-sqlite3 was considered but required native compilation and separate TypeScript setup. Deno was evaluated but its SQLite support was less mature.",
      "lessons_learned": "Bun's test runner is fast but has some compatibility gaps with Jest — had to adjust mocking patterns."
    }
  },
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

  if (config.llm.provider === 'none') {
    throw new ProviderError(
      'lucid curate is an optional feature that requires an LLM provider.\n\n' +
      'To use it, configure one of these options:\n' +
      '  lucid config set llm.provider ollama    # Local (free, needs Ollama installed)\n' +
      '  lucid config set llm.provider anthropic # API (needs ANTHROPIC_API_KEY)\n' +
      '  lucid config set llm.provider openai    # API (needs OPENAI_API_KEY)\n' +
      '  lucid config set llm.provider gemini    # API (needs GEMINI_API_KEY)\n\n' +
      'Tip: You don\'t need curate! Your AI agent can extract memories and use \'lucid add\' directly.',
    );
  }

  const fullPrompt = EXTRACTION_PROMPT + transcript;
  let responseText: string;

  switch (config.llm.provider) {
    case 'anthropic':
      responseText = await callAnthropic(fullPrompt, config.llm.model);
      break;
    case 'openai':
      responseText = await callOpenAI(fullPrompt, config.llm.model);
      break;
    case 'gemini':
      responseText = await callGemini(fullPrompt, config.llm.model);
      break;
    case 'ollama':
      responseText = await callOllama(fullPrompt, config.llm.model);
      break;
    case 'mock':
      responseText = mockLlmResponse(transcript);
      break;
    default:
      throw new ProviderError(
        `Unsupported LLM provider: "${config.llm.provider}". ` +
        'Supported providers: "ollama", "anthropic", "openai", "gemini".',
      );
  }

  return parseLlmResponse(responseText);
}

/**
 * Call Anthropic's API for memory extraction.
 */
async function callAnthropic(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'Set ANTHROPIC_API_KEY environment variable for memory curation.\n' +
      'Get an API key at https://console.anthropic.com/',
    );
  }

  const client = new Anthropic({ apiKey });
  const message = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') {
    throw new ValidationError('Unexpected response type from Anthropic API');
  }
  return block.text;
}

/**
 * Call OpenAI's API for memory extraction.
 */
async function callOpenAI(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'Set OPENAI_API_KEY environment variable for memory curation.\n' +
      'Get an API key at https://platform.openai.com/api-keys',
    );
  }

  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 4096,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new ValidationError('Empty response from OpenAI API');
  }
  return content;
}

/**
 * Call Google Gemini API for memory extraction.
 */
async function callGemini(prompt: string, model: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new ApiKeyError(
      'Set GEMINI_API_KEY environment variable for memory curation.\n' +
      'Get an API key at https://aistudio.google.com/app/apikey',
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({ model });
  const result = await generativeModel.generateContent(prompt);
  const text = result.response.text();

  if (!text) {
    throw new ValidationError('Empty response from Gemini API');
  }
  return text;
}

/**
 * Call Ollama's local API for memory extraction.
 * No API key needed — just requires Ollama running locally.
 */
async function callOllama(prompt: string, model: string): Promise<string> {
  const ollamaModel = model || 'llama3.2';

  try {
    const response = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        prompt,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned status ${response.status}`);
    }

    const data = await response.json() as { response: string };
    if (!data.response) {
      throw new ValidationError('Empty response from Ollama');
    }
    return data.response;
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      throw new ProviderError(
        'Ollama not running. Start it with \'ollama serve\' or install from https://ollama.com',
      );
    }
    throw new ProviderError(`Ollama error: ${message}`);
  }
}

/**
 * Deterministic mock LLM response for testing.
 * Returns a fixed JSON array based on the transcript content.
 */
function mockLlmResponse(transcript: string): string {
  const memories = [
    {
      content: `Mock memory extracted from transcript (${transcript.length} chars)`,
      importance: 0.7,
      tags: ['mock', 'test'],
      contextType: 'PROJECT_CONTEXT',
      triggerPhrases: ['mock memory', 'test extraction'],
      temporalRelevance: 'persistent',
      metadata: {
        decision_rationale: 'Mock decision rationale for testing purposes.',
        lessons_learned: 'Mock lesson learned during testing.',
      },
    },
  ];
  return JSON.stringify(memories);
}

/**
 * Parse the LLM response as JSON and validate each memory entry.
 * Exported for testing.
 */
export function parseLlmResponse(responseText: string): AddMemoryInput[] {
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
    throw new ValidationError(
      'Failed to parse LLM response as JSON. The model returned invalid JSON.\n' +
      `Response preview: ${cleaned.slice(0, 200)}...`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError('LLM response is not a JSON array. Expected an array of memory objects.');
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

    if (typeof record.importance === 'number' && (record.importance < 0 || record.importance > 1)) {
      throw new ValidationError(
        `Invalid importance value: ${record.importance}. Must be between 0.0 and 1.0.`,
      );
    }

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

    const metadata = typeof record.metadata === 'object' && record.metadata !== null && !Array.isArray(record.metadata)
      ? record.metadata as Record<string, unknown>
      : null;

    memories.push({
      content,
      importance,
      tags,
      contextType,
      triggerPhrases,
      temporalRelevance,
      metadata,
    });
  }

  logger.debug(`Extracted ${memories.length} memories from LLM response`);
  return memories;
}
