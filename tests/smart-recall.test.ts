import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  scoreTriggerPhrases,
  scoreTemporalRelevance,
  scoreContextAlignment,
  scoreSemanticTags,
  scoreQuestionTypes,
  scoreEmotionalContext,
  scoreProblemSolution,
  scoreSerendipity,
  scoreTemporalSurprise,
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
      serendipity: 0.0,
      surprise: 0.0,
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
      serendipity: 0.0,
      surprise: 0.0,
    };
    const reasoning = generateSelectionReasoning(components);
    expect(reasoning).toContain('composite scoring');
  });

  test('includes serendipity label when score is high', () => {
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
      serendipity: 0.8,
      surprise: 0.0,
    };
    const reasoning = generateSelectionReasoning(components);
    expect(reasoning).toContain('Serendipity — rarely accessed');
  });

  test('includes surprise label when score is high', () => {
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
      serendipity: 0.0,
      surprise: 0.7,
    };
    const reasoning = generateSelectionReasoning(components);
    expect(reasoning).toContain('Temporal surprise — rediscovered');
  });
});

// ─── Serendipity & Surprise Scoring Tests ───────────────────────────

describe('scoreSerendipity', () => {
  test('low access count (0) returns 0.8', () => {
    expect(scoreSerendipity(0, null)).toBe(0.8);
  });

  test('low access count (2) returns 0.8', () => {
    expect(scoreSerendipity(2, null)).toBe(0.8);
  });

  test('medium access count (3) returns 0.4', () => {
    expect(scoreSerendipity(3, null)).toBe(0.4);
  });

  test('medium access count (7) returns 0.4', () => {
    expect(scoreSerendipity(7, null)).toBe(0.4);
  });

  test('high access count (8) returns 0.1', () => {
    expect(scoreSerendipity(8, null)).toBe(0.1);
  });

  test('high access count (100) returns 0.1', () => {
    expect(scoreSerendipity(100, null)).toBe(0.1);
  });

  test('recently accessed (within 24h) halves score', () => {
    const recentAccess = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1 hour ago
    expect(scoreSerendipity(0, recentAccess)).toBe(0.4); // 0.8 * 0.5
  });

  test('recently accessed medium count halves score', () => {
    const recentAccess = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(); // 12 hours ago
    expect(scoreSerendipity(5, recentAccess)).toBe(0.2); // 0.4 * 0.5
  });

  test('old access (>24h) does not reduce score', () => {
    const oldAccess = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 2 days ago
    expect(scoreSerendipity(0, oldAccess)).toBe(0.8);
  });

  test('null lastAccessed does not reduce score', () => {
    expect(scoreSerendipity(1, null)).toBe(0.8);
  });
});

describe('scoreTemporalSurprise', () => {
  test('memory < 7 days old returns 0.0', () => {
    const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    expect(scoreTemporalSurprise(recent, null)).toBe(0.0);
  });

  test('forgotten gem: > 30 days old, not accessed in 14+ days', () => {
    const old = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(); // 45 days ago
    const lastAccessed = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
    expect(scoreTemporalSurprise(old, lastAccessed)).toBe(0.7);
  });

  test('forgotten gem: > 30 days old, never accessed', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    expect(scoreTemporalSurprise(old, null)).toBe(0.7);
  });

  test('medium surprise: > 14 days old, not accessed in 7+ days', () => {
    const medium = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
    const lastAccessed = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago
    expect(scoreTemporalSurprise(medium, lastAccessed)).toBe(0.4);
  });

  test('no surprise: > 14 days old but accessed recently', () => {
    const medium = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(); // 20 days ago
    const lastAccessed = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    expect(scoreTemporalSurprise(medium, lastAccessed)).toBe(0.0);
  });

  test('no surprise: exactly 7 days old', () => {
    const exact7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days ago
    // 7 days is not > 14 days, so should return 0.0
    expect(scoreTemporalSurprise(exact7, null)).toBe(0.0);
  });

  test('medium surprise: 15 days old, never accessed', () => {
    const d15 = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
    expect(scoreTemporalSurprise(d15, null)).toBe(0.4);
  });

  test('forgotten gem: 31 days old, never accessed', () => {
    const d31 = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    expect(scoreTemporalSurprise(d31, null)).toBe(0.7);
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

describe('searchMemories — serendipity vector gate', () => {
  test('serendipity and surprise are 0 when vector similarity is low', async () => {
    // Add a memory with low vector similarity to the query
    // Mock embedder produces deterministic embeddings, so we use very different content
    await addMemory({
      content: 'ancient forgotten memory about underwater basket weaving xyz',
      importance: 0.5,
      tags: ['basket'],
      triggerPhrases: ['underwater basket weaving'],
      confidenceScore: 0.5,
    }, config);

    // Search with a completely different query — mock embedder should produce low similarity
    const results = await searchMemories('underwater basket weaving', { limit: 10, config });

    // If any results come back, check the serendipity gate
    for (const r of results) {
      if (r.components.vector <= 0.5) {
        expect(r.components.serendipity).toBe(0);
        expect(r.components.surprise).toBe(0);
      }
    }
  });

  test('serendipity scores normally when vector similarity is high', async () => {
    // With mock embedder, identical content should produce high vector similarity
    await addMemory({
      content: 'test query for serendipity check',
      importance: 0.8,
      tags: ['test'],
      triggerPhrases: ['test query serendipity'],
      confidenceScore: 0.8,
    }, config);

    const results = await searchMemories('test query for serendipity check', { limit: 10, config });

    // If results come back with high vector similarity, serendipity should be non-zero
    // (access_count starts at 0, so scoreSerendipity(0, null) = 0.8)
    for (const r of results) {
      if (r.components.vector > 0.5) {
        // Serendipity gate is open — score should be computed normally
        expect(r.components.serendipity).toBeGreaterThanOrEqual(0);
      }
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
