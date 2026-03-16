/**
 * Shared types for Lucid memory system.
 * Re-exports from schema and core modules for convenience.
 */

export { ContextType, type Memory, type Episode, type Config, type EmbeddingConfig, type LlmConfig } from '../storage/schema';
export type { AddMemoryInput } from '../core/memory';
export type { SearchResult, SearchOptions, ScoringComponents, ScoredMemory } from '../core/search';
export type { SaveEpisodeInput, EpisodeSearchResult } from '../core/episodes';
