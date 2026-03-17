/**
 * Smart Vector Retrieval — 10-dimension scoring algorithm.
 *
 * Port of RLabs' SmartVectorRetrieval from Python to TypeScript.
 * Combines vector similarity with 9 additional scoring dimensions
 * for intelligent memory selection with 3-tier prioritization.
 */

import { logger } from '../utils/logger';
import { embed } from './embedder';
import { initDatabase, closeDatabase } from '../storage/db';
import { getDbPath } from '../config';
import { ContextType } from '../storage/schema';
import type { Config, Memory } from '../storage/schema';

// ─── Types ───────────────────────────────────────────────────────────

export interface ScoringComponents {
  trigger: number;
  vector: number;
  importance: number;
  temporal: number;
  context: number;
  tags: number;
  question: number;
  emotion: number;
  problem: number;
  action: number;
  confidence: number;
  serendipity: number;
  surprise: number;
}

export interface ScoredMemory {
  memory: Memory;
  score: number;
  relevance: number;
  reasoning: string;
  components: ScoringComponents;
}

export interface SearchResult extends Memory {
  score: number;
  relevance: number;
  reasoning: string;
  components: ScoringComponents;
}

export interface SearchOptions {
  limit?: number;
  minScore?: number;
  config: Config;
}

interface MemoryWithEmbedding {
  id: string;
  content: string;
  importance: number;
  context_type: string;
  trigger_phrases: string | null;
  source_session: string | null;
  temporal_relevance: string;
  embedding: string | null;
  embedding_dim: number | null;
  created_at: string;
  last_accessed: string | null;
  access_count: number;
  question_types: string | null;
  emotional_resonance: string | null;
  problem_solution_pair: number;
  confidence_score: number;
  action_required: number;
  knowledge_domain: string | null;
  episode_id: string | null;
  source_agent: string | null;
}

// ─── Stop Words ──────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'is', 'are', 'was', 'were', 'to', 'a', 'an', 'and', 'or',
  'but', 'in', 'on', 'at', 'for', 'with', 'about', 'when', 'how',
  'what', 'why',
]);

// ─── Scoring Functions ──────────────────────────────────────────────

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1, where 1 = identical direction.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  if (magnitude === 0) return 0;

  return dotProduct / magnitude;
}

/**
 * Score trigger phrase match against a query message.
 * Port of RLabs' _score_trigger_phrases.
 */
export function scoreTriggerPhrases(message: string, triggerPhrases: string[]): number {
  if (!triggerPhrases.length) return 0.0;

  const messageLower = message.toLowerCase();
  let maxScore = 0.0;

  for (const phrase of triggerPhrases) {
    const phraseLower = phrase.toLowerCase();
    const patternWords = phraseLower
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

    if (patternWords.length === 0) continue;

    let matchCount = 0;
    for (const word of patternWords) {
      const messageWords = messageLower.split(/\s+/);
      // Direct match
      if (messageWords.includes(word)) {
        matchCount += 1.0;
      // Plural/singular match
      } else if (
        messageWords.includes(word + 's') ||
        messageWords.includes(word.replace(/s$/, ''))
      ) {
        matchCount += 0.9;
      // Substring match
      } else if (messageLower.includes(word)) {
        matchCount += 0.7;
      }
    }

    let conceptScore = matchCount / patternWords.length;

    // Situational pattern boost
    const situationalPatterns = ['when', 'during', 'asking about', 'working on', 'trying to'];
    for (const pattern of situationalPatterns) {
      if (phraseLower.includes(pattern) && conceptScore > 0) {
        conceptScore = Math.max(conceptScore, 0.7);
        break;
      }
    }

    maxScore = Math.max(maxScore, conceptScore);
  }

  return Math.min(maxScore, 1.0);
}

/**
 * Score temporal relevance.
 * Port of RLabs' _score_temporal_relevance.
 */
export function scoreTemporalRelevance(temporalType: string): number {
  switch (temporalType) {
    case 'persistent': return 0.8;
    case 'short-term': return 0.6;
    case 'expiring': return 0.3;
    default: return 0.5;
  }
}

/**
 * Score context type alignment with the query message.
 * Port of RLabs' _score_context_alignment.
 */
export function scoreContextAlignment(message: string, contextType: string): number {
  const messageLower = message.toLowerCase();

  const contextIndicators: Record<string, string[]> = {
    TECHNICAL_DECISION: ['decided', 'chose', 'will use', 'approach', 'strategy'],
    TECHNICAL_IMPLEMENTATION: ['bug', 'error', 'fix', 'implement', 'code', 'function'],
    BREAKTHROUGH: ['idea', 'realized', 'discovered', 'insight', 'solution'],
    PROJECT_CONTEXT: ['project', 'building', 'architecture', 'system'],
    PERSONAL_CONTEXT: ['dear friend', 'thank', 'appreciate', 'feel'],
    RELATIONSHIP: ['dear friend', 'thank', 'appreciate', 'feel'],
    UNRESOLVED: ['todo', 'need to', 'should', 'must', 'problem'],
    DEBUGGING_INSIGHT: ['bug', 'error', 'fix', 'implement', 'code', 'function'],
  };

  const indicators = contextIndicators[contextType];
  if (!indicators) return 0.1;

  let matches = 0;
  for (const indicator of indicators) {
    if (messageLower.includes(indicator)) {
      matches++;
    }
  }

  if (matches === 0) return 0.1;
  return Math.min(0.3 + matches * 0.2, 1.0);
}

/**
 * Score semantic tag match against the query message.
 * Port of RLabs' _score_semantic_tags.
 */
export function scoreSemanticTags(message: string, tags: string[]): number {
  if (!tags.length) return 0.0;

  const messageLower = message.toLowerCase();
  let matches = 0;

  for (const tag of tags) {
    if (messageLower.includes(tag.toLowerCase())) {
      matches++;
    }
  }

  if (matches === 0) return 0.0;
  return Math.min(0.3 + matches * 0.3, 1.0);
}

/**
 * Score question type match against the query message.
 * Port of RLabs' _score_question_types.
 */
export function scoreQuestionTypes(message: string, questionTypes: string[]): number {
  if (!questionTypes.length) return 0.0;

  const messageLower = message.toLowerCase();
  let highestMatch = 0.0;

  for (const questionType of questionTypes) {
    const qtLower = questionType.toLowerCase();

    // Full match: question type appears in message
    if (messageLower.includes(qtLower)) {
      highestMatch = Math.max(highestMatch, 0.8);
      continue;
    }

    // Partial: message has a question word AND question type has one too
    const questionWords = ['how', 'why', 'what', 'when', 'where'];
    const messageHasQuestion = questionWords.some((w) => messageLower.includes(w));
    const qtHasQuestion = questionWords.some((w) => qtLower.includes(w));

    if (messageHasQuestion && qtHasQuestion) {
      highestMatch = Math.max(highestMatch, 0.5);
    }
  }

  return highestMatch;
}

/**
 * Score emotional context match against the query message.
 * Port of RLabs' _score_emotional_context.
 */
export function scoreEmotionalContext(message: string, emotion: string): number {
  if (!emotion) return 0.0;

  const messageLower = message.toLowerCase();

  const emotionKeywords: Record<string, string[]> = {
    joy: ['happy', 'excited', 'love', 'wonderful', 'great', 'awesome'],
    frustration: ['stuck', 'confused', 'help', 'issue', 'problem', 'why'],
    discovery: ['realized', 'found', 'discovered', 'aha', 'insight'],
    gratitude: ['thank', 'appreciate', 'grateful', 'dear friend'],
  };

  const keywords = emotionKeywords[emotion.toLowerCase()];
  if (!keywords) return 0.0;

  for (const keyword of keywords) {
    if (messageLower.includes(keyword)) {
      return 0.7;
    }
  }

  return 0.0;
}

/**
 * Score problem-solution pattern match against the query message.
 * Port of RLabs' _score_problem_solution.
 */
export function scoreProblemSolution(message: string, isProblemSolution: boolean): number {
  if (!isProblemSolution) return 0.0;

  const messageLower = message.toLowerCase();
  const problemWords = ['error', 'issue', 'problem', 'stuck', 'help', 'fix', 'solve', 'debug'];

  for (const word of problemWords) {
    if (messageLower.includes(word)) {
      return 0.8;
    }
  }

  return 0.0;
}

/**
 * Score serendipity — inverse access frequency.
 * Rarely accessed memories get boosted; recently-seen ones get penalized.
 */
export function scoreSerendipity(accessCount: number, lastAccessed: string | null): number {
  let score: number;

  if (accessCount <= 2) {
    score = 0.8;
  } else if (accessCount <= 7) {
    score = 0.4;
  } else {
    score = 0.1;
  }

  // If accessed within the last 24 hours, halve the score
  if (lastAccessed) {
    const lastAccessedMs = new Date(lastAccessed).getTime();
    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
    if (lastAccessedMs > twentyFourHoursAgo) {
      score *= 0.5;
    }
  }

  return score;
}

/**
 * Score temporal surprise — old memory rediscovery.
 * Forgotten gems (old + not recently accessed) get boosted.
 */
export function scoreTemporalSurprise(createdAt: string, lastAccessed: string | null): number {
  const now = Date.now();
  const createdMs = new Date(createdAt).getTime();
  const ageMs = now - createdMs;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Too recent to be surprising
  if (ageDays < 7) return 0.0;

  const lastAccessedMs = lastAccessed ? new Date(lastAccessed).getTime() : 0;
  const daysSinceAccess = lastAccessed
    ? (now - lastAccessedMs) / (1000 * 60 * 60 * 24)
    : Infinity; // Never accessed = maximum surprise

  // Forgotten gem: old AND not recently accessed
  if (ageDays > 30 && daysSinceAccess >= 14) return 0.7;
  if (ageDays > 14 && daysSinceAccess >= 7) return 0.4;

  return 0.0;
}

/**
 * Generate human-readable reasoning for why a memory was selected.
 * Port of RLabs' _generate_selection_reasoning.
 */
export function generateSelectionReasoning(components: ScoringComponents): string {
  const labels: Record<string, string> = {
    trigger: 'Strong trigger phrase match',
    vector: 'Vector similarity',
    importance: 'High importance',
    temporal: 'Temporal relevance',
    context: 'Context alignment',
    tags: 'Tag match',
    question: 'Question type match',
    emotion: 'Emotional resonance',
    problem: 'Problem-solution match',
    action: 'Action required',
    confidence: 'High confidence',
    serendipity: 'Serendipity — rarely accessed',
    surprise: 'Temporal surprise — rediscovered',
  };

  // Sort components by score, pick top 1-3 with score > 0.3
  const sorted = Object.entries(components)
    .filter(([, score]) => score > 0.3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3);

  if (sorted.length === 0) {
    return 'Selected due to: composite scoring';
  }

  const reasons = sorted.map(
    ([key, score]) => `${labels[key] || key} (${score.toFixed(2)})`,
  );

  return `Selected due to: ${reasons.join(', ')}`;
}

// ─── Core Search Algorithm ──────────────────────────────────────────

/**
 * Search memories using the SmartVectorRetrieval 10-dimension scoring algorithm.
 * Replaces simple cosine-similarity-only search with composite scoring + 3-tier selection.
 */
export async function searchMemories(
  query: string,
  options: SearchOptions,
): Promise<SearchResult[]> {
  const { config, limit = 5, minScore = 0.0 } = options;

  logger.debug(`Searching memories for: "${query}" (limit=${limit}, minScore=${minScore})`);

  // Generate query embedding
  const queryEmbedding = await embed(query, config);
  const queryDim = queryEmbedding.length;

  const dbPath = getDbPath(config);
  const db = initDatabase(dbPath);

  try {
    // Load memories with embeddings
    const rows = db.query(
      'SELECT * FROM memories WHERE embedding IS NOT NULL AND (embedding_dim = ? OR embedding_dim IS NULL)',
    ).all(queryDim) as MemoryWithEmbedding[];

    logger.debug(`Comparing against ${rows.length} memories with embeddings (dim=${queryDim})`);

    // Step 1: Score every memory on 10 dimensions
    const scored: ScoredMemory[] = [];

    for (const row of rows) {
      if (!row.embedding) continue;

      let memoryEmbedding: number[];
      try {
        memoryEmbedding = JSON.parse(row.embedding) as number[];
      } catch {
        logger.warn(`Invalid embedding for memory ${row.id}, skipping`);
        continue;
      }

      if (memoryEmbedding.length !== queryDim) {
        logger.debug(`Skipping memory ${row.id}: dimension mismatch (${memoryEmbedding.length} vs ${queryDim})`);
        continue;
      }

      // Fetch tags
      const tagRows = db.query(
        'SELECT tag FROM memory_tags WHERE memory_id = ?',
      ).all(row.id) as { tag: string }[];
      const tags = tagRows.map((r) => r.tag);

      // Parse fields
      const triggerPhrases: string[] = row.trigger_phrases
        ? JSON.parse(row.trigger_phrases) as string[]
        : [];
      const questionTypes: string[] = row.question_types
        ? JSON.parse(row.question_types) as string[]
        : [];
      const emotionalResonance = row.emotional_resonance || '';
      const isProblemSolution = row.problem_solution_pair === 1;
      const isActionRequired = row.action_required === 1;
      const confidenceScore = row.confidence_score ?? 0.8;

      // 1. Vector similarity
      const vectorScore = cosineSimilarity(queryEmbedding, memoryEmbedding);

      // 2. Importance weight
      const importance = row.importance;

      // 3. Temporal relevance
      const temporalScore = scoreTemporalRelevance(row.temporal_relevance);

      // 4. Context type alignment
      const contextScore = scoreContextAlignment(query, row.context_type);

      // 5. Action required boost
      const actionBoost = isActionRequired ? 0.3 : 0.0;

      // 6. Semantic tag matching
      const tagScore = scoreSemanticTags(query, tags);

      // 7. Trigger phrase matching
      const triggerScore = scoreTriggerPhrases(query, triggerPhrases);

      // 8. Question type matching
      const questionScore = scoreQuestionTypes(query, questionTypes);

      // 9. Emotional resonance
      const emotionScore = scoreEmotionalContext(query, emotionalResonance);

      // 10. Problem-solution patterns
      const problemScore = scoreProblemSolution(query, isProblemSolution);

      // 11. Serendipity — inverse access frequency (gated behind vector similarity)
      const serendipityScore = vectorScore > 0.5
        ? scoreSerendipity(row.access_count, row.last_accessed)
        : 0.0;

      // 12. Temporal surprise — old memory rediscovery (gated behind vector similarity)
      const surpriseScore = vectorScore > 0.5
        ? scoreTemporalSurprise(row.created_at, row.last_accessed)
        : 0.0;

      // Composite scoring (updated formula with serendipity)

      // Relevance (gatekeeper — max 0.30)
      const relevanceScore =
        triggerScore * 0.10 +
        vectorScore * 0.12 +
        tagScore * 0.05 +
        questionScore * 0.03;

      // Value (max 0.70)
      const valueScore =
        importance * 0.15 +
        temporalScore * 0.08 +
        contextScore * 0.10 +
        confidenceScore * 0.08 +
        emotionScore * 0.08 +
        problemScore * 0.04 +
        actionBoost * 0.04 +
        serendipityScore * 0.04 +
        surpriseScore * 0.03;

      // Final score
      const finalScore = relevanceScore + valueScore;

      // GATEKEEPER: skip if not relevant enough
      if (relevanceScore < 0.05 || finalScore < 0.3) continue;

      const components: ScoringComponents = {
        trigger: triggerScore,
        vector: vectorScore,
        importance,
        temporal: temporalScore,
        context: contextScore,
        tags: tagScore,
        question: questionScore,
        emotion: emotionScore,
        problem: problemScore,
        action: actionBoost,
        confidence: confidenceScore,
        serendipity: serendipityScore,
        surprise: surpriseScore,
      };

      const memory: Memory = {
        id: row.id,
        content: row.content,
        importance: row.importance,
        tags,
        contextType: (row.context_type as ContextType) || ContextType.PROJECT_CONTEXT,
        triggerPhrases,
        sourceSession: row.source_session || '',
        temporalRelevance: (row.temporal_relevance as Memory['temporalRelevance']) || 'persistent',
        createdAt: row.created_at,
        lastAccessed: row.last_accessed,
        accessCount: row.access_count,
        questionTypes,
        emotionalResonance,
        problemSolutionPair: isProblemSolution,
        confidenceScore,
        actionRequired: isActionRequired,
        knowledgeDomain: row.knowledge_domain || '',
        episodeId: row.episode_id || null,
        metadata: row.metadata ? JSON.parse(row.metadata) as Record<string, unknown> : null,
        sourceAgent: row.source_agent || null,
      };

      scored.push({
        memory,
        score: finalScore,
        relevance: relevanceScore,
        reasoning: generateSelectionReasoning(components),
        components,
      });
    }

    // Step 2: 3-Tier selection
    scored.sort((a, b) => b.score - a.score);

    const selected: ScoredMemory[] = [];
    const typesIncluded = new Set<string>();
    const selectedIds = new Set<string>();

    // Tier 1: MUST include
    for (const m of scored) {
      if (selectedIds.has(m.memory.id)) continue;
      const isMust =
        m.score > 0.8 ||
        m.components.importance > 0.9 ||
        m.components.action > 0 ||
        Object.values(m.components).some((v) => v > 0.9);

      if (isMust) {
        selected.push(m);
        selectedIds.add(m.memory.id);
        typesIncluded.add(m.memory.contextType);
      }
    }

    // Tier 2: SHOULD include (diversity)
    // Sort candidates by score + diversity bonus for context types not yet represented
    const shouldCap = Math.ceil(limit * 1.5);
    const tier2Candidates = scored
      .filter((m) => !selectedIds.has(m.memory.id))
      .map((m) => {
        const diversityBonus = !typesIncluded.has(m.memory.contextType) ? 0.15 : 0;
        return { ...m, effectiveScore: m.score + diversityBonus };
      })
      .sort((a, b) => b.effectiveScore - a.effectiveScore);

    for (const m of tier2Candidates) {
      if (selected.length >= shouldCap) break;

      const isShould =
        m.score > 0.5 ||
        !typesIncluded.has(m.memory.contextType) ||
        m.components.emotion > 0;

      if (isShould) {
        selected.push(m);
        selectedIds.add(m.memory.id);
        typesIncluded.add(m.memory.contextType);
      }
    }

    // Tier 3: CONTEXT enrichment
    const contextCap = Math.ceil(limit * 2.0);
    const selectedTags = new Set<string>();
    const selectedDomains = new Set<string>();
    for (const m of selected) {
      for (const tag of m.memory.tags) selectedTags.add(tag);
      if (m.memory.knowledgeDomain) selectedDomains.add(m.memory.knowledgeDomain);
    }

    for (const m of scored) {
      if (selected.length >= contextCap) break;
      if (selectedIds.has(m.memory.id)) continue;

      const sharesContext =
        m.memory.tags.some((t) => selectedTags.has(t)) ||
        (m.memory.knowledgeDomain && selectedDomains.has(m.memory.knowledgeDomain));

      if (sharesContext) {
        selected.push(m);
        selectedIds.add(m.memory.id);
      }
    }

    // Step 3: Final sort by score and strict limit
    selected.sort((a, b) => b.score - a.score);
    const finalResults = selected.slice(0, limit);

    // Build results and update access tracking
    const results: SearchResult[] = [];

    for (const { memory, score, relevance, reasoning, components } of finalResults) {
      // Update access tracking
      db.run(
        'UPDATE memories SET last_accessed = datetime(\'now\'), access_count = access_count + 1 WHERE id = ?',
        [memory.id],
      );

      results.push({
        ...memory,
        score,
        relevance,
        reasoning,
        components,
      });
    }

    logger.debug(`Found ${results.length} results after smart scoring + 3-tier selection`);
    return results;
  } finally {
    closeDatabase();
  }
}
