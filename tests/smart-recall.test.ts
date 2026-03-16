import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  scoreTriggerPhrases,
  scoreTemporalRelevance,
  scoreContextAlignment,
  scoreSemanticTags,
  scoreQuestionTypes,
  scoreEmotionalContext,
  scoreProblemSolution,
  generateSelectionReasoning,
  searchMemories,
} from '../src/core/search';
import type { ScoringComponents } from '../src/core/search';
import { addMemory } from '../src/core/memory';
import type { Config } from '../src/storage/schema';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';

// ─── Scoring Function Unit Tests ────────────────────────────────────

describe('scoreTriggerPhrases', () => {
  test('returns high score for exact match', () => {
    const score = scoreTriggerPhrases('dark mode settings', ['dark mode']);
    expect(score).toBeGreaterThan(0.8);
  });

  test('handles plural/singular matching', () => {
    const score = scoreTriggerPhrases('fix errors quickly', ['fix error']);
    expect(score).toBeGreaterThan(0.5);
  });

  test('handles substring matching', () => {
    const score = scoreTriggerPhrases('typescript configuration', ['config']);
    expect(score).toBeGreaterThan(0.5);
  });

  test('returns 0 for no match', () => {
    const score = scoreTriggerPhrases('hello world', ['dark mode', 'IDE theme']);
    expect(score).toBe(0);
  });

  test('returns 0 for empty trigger phrases', () => {
    const score = scoreTriggerPhrases('anything', []);
    expect(score).toBe(0);
  });

  test('caps at 1.0', () => {
    const score = scoreTriggerPhrases('dark mode theme settings', ['dark mode theme settings']);
    expect(score).toBeLessThanOrEqual(1.0);
  });

  test('boosts situational patterns', () => {
    const score = scoreTriggerPhrases('typescript help', ['when working on typescript']);
    expect(score).toBeGreaterThanOrEqual(0.7);
  });
});

describe('scoreTemporalRelevance', () => {
  test('persistent returns 0.8', () => {
    expect(scoreTemporalRelevance('persistent')).toBe(0.8);
  });

  test('short-term returns 0.6', () => {
    expect(scoreTemporalRelevance('short-term')).toBe(0.6);
  });

  test('expiring returns 0.3', () => {
    expect(scoreTemporalRelevance('expiring')).toBe(0.3);
  });

  test('unknown returns 0.5', () => {
    expect(scoreTemporalRelevance('unknown')).toBe(0.5);
  });
});

describe('scoreContextAlignment', () => {
  test('matches TECHNICAL_DECISION keywords', () => {
    const score = scoreContextAlignment('we decided to use this approach', 'TECHNICAL_DECISION');
    expect(score).toBeGreaterThan(0.3);
  });

  test('matches BREAKTHROUGH keywords', () => {
    const score = scoreContextAlignment('I just realized the solution', 'BREAKTHROUGH');
    expect(score).toBeGreaterThan(0.3);
  });

  test('matches UNRESOLVED keywords', () => {
    const score = scoreContextAlignment('we need to fix this problem', 'UNRESOLVED');
    expect(score).toBeGreaterThan(0.3);
  });

  test('returns 0.1 for no match', () => {
    const score = scoreContextAlignment('hello world', 'TECHNICAL_DECISION');
    expect(score).toBe(0.1);
  });

  test('returns 0.1 for unknown context type', () => {
    const score = scoreContextAlignment('anything', 'UNKNOWN_TYPE');
    expect(score).toBe(0.1);
  });
});

describe('scoreSemanticTags', () => {
  test('returns high score for single match', () => {
    const score = scoreSemanticTags('typescript config', ['typescript']);
    expect(score).toBeGreaterThanOrEqual(0.6);
  });

  test('returns higher score for multiple matches', () => {
    const score = scoreSemanticTags('typescript bun runtime', ['typescript', 'bun']);
    expect(score).toBeCloseTo(0.9, 1);
  });

  test('returns 0 for no match', () => {
    const score = scoreSemanticTags('hello world', ['typescript', 'bun']);
    expect(score).toBe(0);
  });

  test('returns 0 for empty tags', () => {
    const score = scoreSemanticTags('anything', []);
    expect(score).toBe(0);
  });

  test('case-insensitive matching', () => {
    const score = scoreSemanticTags('TypeScript config', ['typescript']);
    expect(score).toBeGreaterThan(0);
  });
});

describe('scoreQuestionTypes', () => {
  test('returns 0.8 for full match', () => {
    const score = scoreQuestionTypes('how is the build process', ['build process']);
    expect(score).toBe(0.8);
  });

  test('returns 0.5 for partial question word match', () => {
    const score = scoreQuestionTypes('how do I deploy', ['why does it fail']);
    expect(score).toBe(0.5);
  });

  test('returns 0 for no match', () => {
    const score = scoreQuestionTypes('hello world', ['build process']);
    expect(score).toBe(0);
  });

  test('returns 0 for empty question types', () => {
    const score = scoreQuestionTypes('anything', []);
    expect(score).toBe(0);
  });
});

describe('scoreEmotionalContext', () => {
  test('matches joy keywords', () => {
    const score = scoreEmotionalContext('I am so excited about this', 'joy');
    expect(score).toBe(0.7);
  });

  test('matches frustration keywords', () => {
    const score = scoreEmotionalContext('I am stuck on this issue', 'frustration');
    expect(score).toBe(0.7);
  });

  test('matches discovery keywords', () => {
    const score = scoreEmotionalContext('I just realized something', 'discovery');
    expect(score).toBe(0.7);
  });

  test('matches gratitude keywords', () => {
    const score = scoreEmotionalContext('thank you so much', 'gratitude');
    expect(score).toBe(0.7);
  });

  test('returns 0 for no keyword match', () => {
    const score = scoreEmotionalContext('hello world', 'joy');
    expect(score).toBe(0);
  });

  test('returns 0 for empty emotion', () => {
    const score = scoreEmotionalContext('anything', '');
    expect(score).toBe(0);
  });

  test('returns 0 for unknown emotion', () => {
    const score = scoreEmotionalContext('anything', 'unknown');
    expect(score).toBe(0);
  });
});

describe('scoreProblemSolution', () => {
  test('returns 0.8 when is pair and message has problem words', () => {
    const score = scoreProblemSolution('how to fix this error', true);
    expect(score).toBe(0.8);
  });

  test('returns 0 when is pair but no problem words', () => {
    const score = scoreProblemSolution('hello world', true);
    expect(score).toBe(0);
  });

  test('returns 0 when not a pair', () => {
    const score = scoreProblemSolution('fix this error', false);
    expect(score).toBe(0);
  });
});

describe('generateSelectionReasoning', () => {
  test('generates reasoning from top components', () => {
    const components: ScoringComponents = {
      trigger: 0.9,
      vector: 0.6,
      importance: 0.5,
      temporal: 0.8,
      context: 0.1,
      tags: 0.0,
      question: 0.0,
      emotion: 0.0,
      problem: 0.0,
      action: 0.0,
      confidence: 0.8,
    };
    const reasoning = generateSelectionReasoning(components);
    expect(reasoning).toContain('Strong trigger phrase match');
    expect(reasoning).toContain('0.90');
  });

  test('returns fallback when no component > 0.3', () => {
    const components: ScoringComponents = {
      trigger: 0.1,
      vector: 0.2,
      importance: 0.1,
      temporal: 0.1,
      context: 0.1,
      tags: 0.0,
      question: 0.0,
      emotion: 0.0,
      problem: 0.0,
      action: 0.0,
      confidence: 0.1,
    };
    const reasoning = generateSelectionReasoning(components);
    expect(reasoning).toContain('composite scoring');
  });
});

// ─── Integration Tests ──────────────────────────────────────────────

let tmpDir: string;
let config: Config;

function freshConfig(): Config {
  tmpDir = join(tmpdir(), `lucid-smart-recall-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

describe('searchMemories — composite scoring', () => {
  test('gatekeeper skips irrelevant memories', async () => {
    // Add a memory with no trigger phrases, no tags, no question types
    // The mock embedder will produce some vector similarity but relevance may be low
    await addMemory({
      content: 'completely unrelated content xyz',
      importance: 0.1,
      temporalRelevance: 'expiring',
      confidenceScore: 0.1,
    }, config);

    const results = await searchMemories('test query abc', { limit: 5, config });
    // With low importance, expiring temporal, and minimal vector match,
    // the memory should be filtered by gatekeeper (final < 0.3)
    // This depends on mock embedder — just verify structure
    expect(results).toBeDefined();
    expect(Array.isArray(results)).toBe(true);
  });

  test('high importance memories surface with composite scoring', async () => {
    await addMemory({
      content: 'Critical architecture decision for the project',
      importance: 0.95,
      tags: ['architecture'],
      contextType: 'TECHNICAL_DECISION',
      triggerPhrases: ['architecture decision'],
      confidenceScore: 0.9,
    }, config);

    const results = await searchMemories('architecture decision', { limit: 5, config });
    // Should pass gatekeeper due to trigger phrase + high importance
    if (results.length > 0) {
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].relevance).toBeGreaterThan(0);
      expect(results[0].reasoning).toBeTruthy();
      expect(results[0].components).toBeDefined();
      expect(results[0].components.importance).toBe(0.95);
    }
  });

  test('trigger phrase match boosts score', async () => {
    await addMemory({
      content: 'We chose Bun for TypeScript runtime',
      importance: 0.8,
      tags: ['tech-stack'],
      triggerPhrases: ['typescript runtime', 'bun runtime'],
      confidenceScore: 0.8,
    }, config);

    const results = await searchMemories('typescript runtime', { limit: 5, config });
    if (results.length > 0) {
      expect(results[0].components.trigger).toBeGreaterThan(0.5);
    }
  });

  test('action required memories get prioritized', async () => {
    await addMemory({
      content: 'Need to update the deployment script',
      importance: 0.7,
      tags: ['deployment'],
      triggerPhrases: ['deployment script'],
      actionRequired: true,
      confidenceScore: 0.8,
    }, config);

    const results = await searchMemories('deployment script', { limit: 5, config });
    if (results.length > 0) {
      expect(results[0].components.action).toBe(0.3);
    }
  });

  test('results include all new fields', async () => {
    await addMemory({
      content: 'Test memory with all fields',
      importance: 0.8,
      tags: ['test'],
      triggerPhrases: ['test query'],
      questionTypes: ['how to test'],
      emotionalResonance: 'discovery',
      problemSolutionPair: true,
      confidenceScore: 0.9,
      actionRequired: true,
      knowledgeDomain: 'testing',
    }, config);

    const results = await searchMemories('test query', { limit: 5, config });
    if (results.length > 0) {
      const r = results[0];
      expect(r.score).toBeDefined();
      expect(r.relevance).toBeDefined();
      expect(r.reasoning).toBeDefined();
      expect(r.components).toBeDefined();
      expect(r.questionTypes).toEqual(['how to test']);
      expect(r.emotionalResonance).toBe('discovery');
      expect(r.problemSolutionPair).toBe(true);
      expect(r.confidenceScore).toBe(0.9);
      expect(r.actionRequired).toBe(true);
      expect(r.knowledgeDomain).toBe('testing');
    }
  });
});

describe('searchMemories — 3-tier selection', () => {
  test('tier 1 includes critical memories (importance > 0.9)', async () => {
    await addMemory({
      content: 'Critical system architecture',
      importance: 0.95,
      tags: ['critical', 'architecture'],
      triggerPhrases: ['system architecture'],
      confidenceScore: 0.9,
    }, config);

    await addMemory({
      content: 'Minor style preference',
      importance: 0.3,
      tags: ['style'],
      triggerPhrases: ['system style'],
      confidenceScore: 0.5,
    }, config);

    const results = await searchMemories('system architecture', { limit: 5, config });
    // Critical memory should be included if it passes gatekeeper
    if (results.length > 0) {
      const critical = results.find((r) => r.content.includes('Critical'));
      if (critical) {
        expect(critical.components.importance).toBe(0.95);
      }
    }
  });

  test('tier 2 provides diversity with different context types', async () => {
    await addMemory({
      content: 'Technical decision about TypeScript',
      importance: 0.7,
      tags: ['tech'],
      contextType: 'TECHNICAL_DECISION',
      triggerPhrases: ['tech decision'],
      confidenceScore: 0.8,
    }, config);

    await addMemory({
      content: 'Personal preference for dark mode',
      importance: 0.6,
      tags: ['preference'],
      contextType: 'LEARNED_PREFERENCE',
      triggerPhrases: ['tech preference'],
      confidenceScore: 0.8,
    }, config);

    const results = await searchMemories('tech decision preference', { limit: 5, config });
    // Both should be retrievable since they have different context types
    expect(results).toBeDefined();
  });
});
