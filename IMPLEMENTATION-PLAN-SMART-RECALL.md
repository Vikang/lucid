# Implementation Plan: Smart Recall (RLabs Algorithm Port)

> **Goal:** Port RLabs' `SmartVectorRetrieval` scoring algorithm from Python to TypeScript.
> **Source:** https://github.com/RLabs-Inc/memory (MIT License)
> **Reference file:** `python/memory_engine/retrieval_strategies.py` (554 lines)
> **Our target:** `src/core/search.ts` + supporting schema/CLI changes

---

## Part 1: Schema Expansion

### 1A. Update `src/storage/schema.ts`

**Add new fields to the `Memory` interface:**

```typescript
export interface Memory {
  // EXISTING (keep all)
  id: string;
  content: string;
  importance: number;           // maps to RLabs' importance_weight
  tags: string[];               // maps to RLabs' semantic_tags
  contextType: ContextType;     // maps to RLabs' context_type
  triggerPhrases: string[];     // maps to RLabs' trigger_phrases
  sourceSession: string;
  temporalRelevance: 'persistent' | 'short-term' | 'expiring';
  createdAt: string;
  lastAccessed: string | null;
  accessCount: number;

  // NEW — needed for RLabs algorithm
  questionTypes: string[];        // maps to RLabs' question_types — e.g. ["how is X built", "build process"]
  emotionalResonance: string;     // maps to RLabs' emotional_resonance — e.g. "discovery", "frustration", "joy", "gratitude"
  problemSolutionPair: boolean;   // maps to RLabs' problem_solution_pair
  confidenceScore: number;        // maps to RLabs' confidence_score (0-1, default 0.8)
  actionRequired: boolean;        // maps to RLabs' action_required
  knowledgeDomain: string;        // maps to RLabs' knowledge_domain — e.g. "architecture", "deployment"
}
```

**Expand ContextType enum to match RLabs:**

```typescript
export enum ContextType {
  // EXISTING
  TECHNICAL_DECISION = 'TECHNICAL_DECISION',
  LEARNED_PREFERENCE = 'LEARNED_PREFERENCE',
  PROJECT_CONTEXT = 'PROJECT_CONTEXT',
  WORKFLOW_PATTERN = 'WORKFLOW_PATTERN',
  DEBUGGING_INSIGHT = 'DEBUGGING_INSIGHT',
  PERSONAL_CONTEXT = 'PERSONAL_CONTEXT',
  // NEW — from RLabs
  BREAKTHROUGH = 'BREAKTHROUGH',
  UNRESOLVED = 'UNRESOLVED',
  MILESTONE = 'MILESTONE',
  RELATIONSHIP = 'RELATIONSHIP',
  TECHNICAL_IMPLEMENTATION = 'TECHNICAL_IMPLEMENTATION',
}
```

**Update SQL CREATE statement:**

Add these columns to CREATE_MEMORIES_TABLE:
```sql
  question_types TEXT,          -- JSON array
  emotional_resonance TEXT,     -- string: joy|frustration|discovery|gratitude|""
  problem_solution_pair INTEGER DEFAULT 0,  -- boolean
  confidence_score REAL DEFAULT 0.8,
  action_required INTEGER DEFAULT 0,        -- boolean
  knowledge_domain TEXT DEFAULT ''
```

### 1B. Update `src/storage/db.ts`

Add migration to add the new columns to existing databases:
```typescript
// Migration: add smart recall metadata columns
const newColumns = [
  { name: 'question_types', type: 'TEXT' },
  { name: 'emotional_resonance', type: 'TEXT' },
  { name: 'problem_solution_pair', type: 'INTEGER DEFAULT 0' },
  { name: 'confidence_score', type: 'REAL DEFAULT 0.8' },
  { name: 'action_required', type: 'INTEGER DEFAULT 0' },
  { name: 'knowledge_domain', type: "TEXT DEFAULT ''" },
];
// For each, try ALTER TABLE ADD COLUMN (ignore if exists)
```

---

## Part 2: Update AddMemoryInput + Memory CRUD

### 2A. Update `src/core/memory.ts`

**Expand `AddMemoryInput`:**

```typescript
export interface AddMemoryInput {
  // EXISTING
  content: string;
  importance?: number;
  tags?: string[];
  contextType?: string;
  triggerPhrases?: string[];
  sourceSession?: string;
  temporalRelevance?: 'persistent' | 'short-term' | 'expiring';
  // NEW
  questionTypes?: string[];
  emotionalResonance?: string;
  problemSolutionPair?: boolean;
  confidenceScore?: number;
  actionRequired?: boolean;
  knowledgeDomain?: string;
}
```

**Update `addMemory()` INSERT statement** to include the 6 new columns.

**Update `rowToMemory()` to read the 6 new columns** from the DB row and populate the Memory object.

**Update `MemoryRow` interface** to include the 6 new column types.

---

## Part 3: Rewrite `src/core/search.ts` — THE BIG ONE

This is a direct TypeScript port of RLabs' `SmartVectorRetrieval` class.

### 3A. Keep existing `cosineSimilarity()` function — unchanged.

### 3B. Add these new scoring functions (port from RLabs Python):

**`scoreTriggerPhrases(message: string, triggerPhrases: string[]): number`**
- Port of `_score_trigger_phrases`
- Stop word removal: `{'the', 'is', 'are', 'was', 'were', 'to', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'for', 'with', 'about', 'when', 'how', 'what', 'why'}`
- For each trigger phrase:
  - Extract key words (non-stop, length > 2)
  - For each key word, check: direct match → 1.0, plural/singular → 0.9, substring → 0.7
  - concept_score = matches / pattern_words.length
  - Boost to 0.7 for situational patterns ("when", "during", "asking about", etc.)
- Return max score across all trigger phrases, capped at 1.0

**`scoreTemporalRelevance(temporalType: string): number`**
- Port of `_score_temporal_relevance`
- Lookup: persistent=0.8, short-term=0.6 (mapped from "session"), expiring=0.3 (mapped from "temporary"), default=0.5

**`scoreContextAlignment(message: string, contextType: string): number`**
- Port of `_score_context_alignment`
- Keyword indicators per context type:
  ```
  TECHNICAL_DECISION/TECHNICAL_IMPLEMENTATION: ['bug', 'error', 'fix', 'implement', 'code', 'function']
  BREAKTHROUGH: ['idea', 'realized', 'discovered', 'insight', 'solution']
  PROJECT_CONTEXT: ['project', 'building', 'architecture', 'system']
  PERSONAL_CONTEXT/RELATIONSHIP: ['dear friend', 'thank', 'appreciate', 'feel']
  UNRESOLVED: ['todo', 'need to', 'should', 'must', 'problem']
  TECHNICAL_DECISION: ['decided', 'chose', 'will use', 'approach', 'strategy']
  ```
- matches = count of indicators found in message
- Return: 0 matches → 0.1, else min(0.3 + matches * 0.2, 1.0)

**`scoreSemanticTags(message: string, tags: string[]): number`**
- Port of `_score_semantic_tags`
- For each tag, check if tag appears in message (case-insensitive)
- Return: 0 matches → 0.0, else min(0.3 + matches * 0.3, 1.0)

**`scoreQuestionTypes(message: string, questionTypes: string[]): number`**
- Port of `_score_question_types`
- For each question type: full match in message → 0.8
- Partial: if message has a question word (how/why/what/when/where) AND question type has one too → 0.5
- Return highest match, default 0.0

**`scoreEmotionalContext(message: string, emotion: string): number`**
- Port of `_score_emotional_context`
- Emotion keyword map:
  ```
  joy: ['happy', 'excited', 'love', 'wonderful', 'great', 'awesome']
  frustration: ['stuck', 'confused', 'help', 'issue', 'problem', 'why']
  discovery: ['realized', 'found', 'discovered', 'aha', 'insight']
  gratitude: ['thank', 'appreciate', 'grateful', 'dear friend']
  ```
- If any keyword in message matches the emotion's patterns → 0.7, else 0.0

**`scoreProblemSolution(message: string, isProblemSolution: boolean): number`**
- Port of `_score_problem_solution`
- If not a problem-solution pair → 0.0
- Problem words: ['error', 'issue', 'problem', 'stuck', 'help', 'fix', 'solve', 'debug']
- If any found in message → 0.8, else 0.0

**`generateSelectionReasoning(components: ScoringComponents): string`**
- Port of `_generate_selection_reasoning`
- Sort all component scores, pick top 1-3 with score > 0.3
- Return human-readable string: "Selected due to: Strong trigger phrase match (0.90), tag match (0.60)"

### 3C. New `ScoringComponents` interface:

```typescript
interface ScoringComponents {
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
}
```

### 3D. New `ScoredMemory` interface:

```typescript
interface ScoredMemory {
  memory: Memory;
  score: number;
  relevance: number;
  reasoning: string;
  components: ScoringComponents;
}
```

### 3E. Rewrite `searchMemories()` — the core algorithm:

**Step 1: Score every memory on 10 dimensions**

For each memory in DB:
```typescript
// 1. Vector similarity (0-1)
const vectorScore = cosineSimilarity(queryEmbedding, memoryEmbedding);

// 2. Importance weight (0-1)
const importance = memory.importance;

// 3. Temporal relevance
const temporalScore = scoreTemporalRelevance(memory.temporalRelevance);

// 4. Context type alignment
const contextScore = scoreContextAlignment(query, memory.contextType);

// 5. Action required boost
const actionBoost = memory.actionRequired ? 0.3 : 0.0;

// 6. Semantic tag matching
const tagScore = scoreSemanticTags(query, memory.tags);

// 7. Trigger phrase matching
const triggerScore = scoreTriggerPhrases(query, memory.triggerPhrases);

// 8. Question type matching
const questionScore = scoreQuestionTypes(query, memory.questionTypes);

// 9. Emotional resonance
const emotionScore = scoreEmotionalContext(query, memory.emotionalResonance);

// 10. Problem-solution patterns
const problemScore = scoreProblemSolution(query, memory.problemSolutionPair);

// Confidence
const confidenceScore = memory.confidenceScore;
```

**Step 2: Calculate composite scores (exact RLabs formula)**

```typescript
// Relevance score (gatekeeper — max 0.30)
const relevanceScore =
  triggerScore * 0.10 +
  vectorScore * 0.10 +
  tagScore * 0.05 +
  questionScore * 0.05;

// Value score (max 0.70)
const valueScore =
  importance * 0.20 +
  temporalScore * 0.10 +
  contextScore * 0.10 +
  confidenceScore * 0.10 +
  emotionScore * 0.10 +
  problemScore * 0.05 +
  actionBoost * 0.05;

// Final score
const finalScore = relevanceScore + valueScore;

// GATEKEEPER: skip if not relevant enough
if (relevanceScore < 0.05 || finalScore < 0.3) continue;
```

**Step 3: 3-Tier selection (exact RLabs logic)**

```typescript
// Tier 1: MUST include
// score > 0.8 OR importance > 0.9 OR action required OR any component > 0.9
const mustInclude = scored.filter(m =>
  m.score > 0.8 ||
  m.components.importance > 0.9 ||
  m.components.action > 0 ||
  Object.values(m.components).some(v => v > 0.9)
);

// Tier 2: SHOULD include (diverse perspectives)
// score > 0.5 OR new context type OR has emotional resonance
// Track types_included to ensure diversity

// Tier 3: CONTEXT enrichment
// Share tags or knowledge_domain with already-selected memories
```

**Step 4: Return top N with reasoning**

### 3F. Update `SearchResult` interface:

```typescript
export interface SearchResult extends Memory {
  score: number;
  relevance: number;
  reasoning: string;
  components: ScoringComponents;
}
```

---

## Part 4: Update CLI

### 4A. Update `src/cli/add.ts`

Add new options:
```
--triggers <phrases>      Comma-separated trigger phrases
--questions <types>       Comma-separated question types this memory answers
--emotion <type>          Emotional resonance: joy|frustration|discovery|gratitude
--problem-solution        Mark as problem-solution pair
--confidence <score>      Confidence 0.0-1.0 (default: 0.8)
--action-required         Mark as requiring action
--domain <domain>         Knowledge domain
```

Pass these through to `addMemory()`.

### 4B. Update `src/cli/recall.ts`

Update output format to show reasoning:
```
Found 3 memories:

  [0.82] We chose TypeScript with Bun as the runtime
  → Selected due to: Strong trigger phrase match (0.90), tag match (0.60)
  tags: tech-stack | importance: 0.9 | TECHNICAL_DECISION

  [0.65] Victoria prefers CLI-first tools
  → Context alignment + high importance
  tags: preference | importance: 0.85 | LEARNED_PREFERENCE
```

When `--json` is used, include full `components` object in output.

### 4C. Update `src/cli/list.ts`

Show the new fields when `--json` is used (no change to default display).

---

## Part 5: Update Tests

### 5A. New test file: `tests/smart-recall.test.ts`

Test each scoring function individually:
- `scoreTriggerPhrases`: exact match, plural handling, substring, situational boost, no match
- `scoreTemporalRelevance`: each type returns correct value
- `scoreContextAlignment`: keyword matching for each context type, no match
- `scoreSemanticTags`: single match, multiple matches, no match
- `scoreQuestionTypes`: full match, partial match, no match
- `scoreEmotionalContext`: each emotion type, no match
- `scoreProblemSolution`: with problem words, without, not a pair

Test the composite scoring:
- Gatekeeper skips irrelevant memories (relevance < 0.05 or final < 0.3)
- High importance memories surface even with low vector similarity
- Trigger phrase match boosts score significantly
- Action required memories get prioritized

Test the 3-tier selection:
- Tier 1 includes critical memories
- Tier 2 provides diversity (different context types)
- Tier 3 enriches with related context (shared tags)

### 5B. Update existing tests

- `tests/search.test.ts`: cosineSimilarity tests stay the same. Integration tests need updating for new return format.
- `tests/memory.test.ts`: addMemory tests need updating for new fields.
- `tests/integration.test.ts`: full pipeline test needs updating for new schema.

---

## Part 6: Things NOT to Change

- **Embedder** (`src/core/embedder.ts`) — no changes needed. Still local-first, still works.
- **Config** (`src/config/index.ts`) — no changes needed.
- **Curator** (`src/core/curator.ts`) — no changes needed. Still optional.
- **DB layer** (`src/storage/db.ts`) — only add migration for new columns.
- **Transcript parser** — no changes.
- **Logger** — no changes.
- **CLI commands**: init, status, config, curate, forget — no changes.

---

## Checklist for Robin

- [ ] Update `src/storage/schema.ts` — Memory interface, ContextType enum, SQL CREATE
- [ ] Update `src/storage/db.ts` — migration for 6 new columns
- [ ] Update `src/core/memory.ts` — AddMemoryInput, addMemory(), rowToMemory(), MemoryRow
- [ ] Rewrite `src/core/search.ts` — 8 scoring functions + composite scoring + 3-tier selection + reasoning
- [ ] Update `src/types/index.ts` — re-export new types
- [ ] Update `src/cli/add.ts` — 6 new options (--triggers, --questions, --emotion, --problem-solution, --confidence, --action-required, --domain)
- [ ] Update `src/cli/recall.ts` — show reasoning in output
- [ ] Create `tests/smart-recall.test.ts` — comprehensive tests for all scoring functions
- [ ] Update `tests/memory.test.ts` — new fields in addMemory
- [ ] Update `tests/search.test.ts` — new return format
- [ ] Update `tests/integration.test.ts` — full pipeline with new schema
- [ ] `bun run lint` — must pass
- [ ] `bun test` — all tests must pass
- [ ] Manual test: add memories with rich metadata, recall with various queries, verify scoring
- [ ] Commit: "Smart recall: port RLabs 10-dimension scoring algorithm"
- [ ] Push to origin main

---

## File Change Summary

| File | Change Type | Scope |
|------|------------|-------|
| `src/storage/schema.ts` | MODIFY | Add 6 fields to Memory, expand ContextType, update SQL |
| `src/storage/db.ts` | MODIFY | Add column migration |
| `src/core/memory.ts` | MODIFY | Expand AddMemoryInput, update addMemory/rowToMemory |
| `src/core/search.ts` | **REWRITE** | Port entire SmartVectorRetrieval algorithm |
| `src/types/index.ts` | MODIFY | Re-export new types |
| `src/cli/add.ts` | MODIFY | Add 7 new CLI options |
| `src/cli/recall.ts` | MODIFY | Show reasoning in output |
| `tests/smart-recall.test.ts` | **NEW** | Comprehensive scoring function tests |
| `tests/memory.test.ts` | MODIFY | Update for new fields |
| `tests/search.test.ts` | MODIFY | Update for new return format |
| `tests/integration.test.ts` | MODIFY | Update for new schema |

**Estimated lines changed:** ~800 new/modified across all files.
**Core algorithm (search.ts):** ~400 lines (up from ~120).
