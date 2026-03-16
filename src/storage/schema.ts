/**
 * Database schema definitions and TypeScript types for Lucid.
 */

export enum ContextType {
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

export interface Memory {
  id: string;
  content: string;
  importance: number;
  tags: string[];
  contextType: ContextType;
  triggerPhrases: string[];
  sourceSession: string;
  temporalRelevance: 'persistent' | 'short-term' | 'expiring';
  createdAt: string;
  lastAccessed: string | null;
  accessCount: number;
  // NEW — needed for RLabs algorithm
  questionTypes: string[];
  emotionalResonance: string;
  problemSolutionPair: boolean;
  confidenceScore: number;
  actionRequired: boolean;
  knowledgeDomain: string;
}

export interface EmbeddingConfig {
  provider: 'local' | 'openai' | 'gemini' | 'mock' | string;
  model: string;
}

export interface LlmConfig {
  provider: 'none' | 'ollama' | 'anthropic' | 'openai' | 'gemini' | 'mock' | string;
  model: string;
}

export interface Config {
  dataDir: string;
  embedding: EmbeddingConfig;
  llm: LlmConfig;
  version: string;
}

/**
 * SQL statements for creating the database schema.
 */
export const CREATE_MEMORIES_TABLE = `
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  importance REAL DEFAULT 0.5,
  context_type TEXT NOT NULL DEFAULT 'PROJECT_CONTEXT',
  trigger_phrases TEXT,
  source_session TEXT,
  temporal_relevance TEXT DEFAULT 'persistent',
  embedding TEXT,
  embedding_dim INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_accessed TEXT,
  access_count INTEGER DEFAULT 0,
  question_types TEXT,
  emotional_resonance TEXT,
  problem_solution_pair INTEGER DEFAULT 0,
  confidence_score REAL DEFAULT 0.8,
  action_required INTEGER DEFAULT 0,
  knowledge_domain TEXT DEFAULT ''
);
`;

export const CREATE_MEMORY_TAGS_TABLE = `
CREATE TABLE IF NOT EXISTS memory_tags (
  memory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (memory_id, tag),
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
`;
