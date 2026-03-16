# Implementation Plan: Episodic Memory (v0.2)

> **Goal:** Add conversation transcript storage + search + session primers
> **References:** RLabs session_primer.py + Episodic project memory-system.md
> **Builds on:** Existing SQLite storage, local embeddings, smart recall algorithm

---

## What We're Building

Three new capabilities:

1. **`lucid session save`** — Store a conversation transcript as an "episode"
2. **`lucid session search`** — Semantic search across past conversations
3. **`lucid session primer`** — Generate a context block about previous sessions
4. **`lucid session list`** — Browse past sessions

Plus: link memories back to their source episode.

---

## Part 1: Schema — New `episodes` Table

### 1A. Add to `src/storage/schema.ts`

New interface:
```typescript
export interface Episode {
  id: string;                    // UUID
  label: string;                 // Human-readable label ("Lucid project kickoff")
  summary: string;               // Brief summary of what happened
  transcript: string;            // Full conversation text
  messageCount: number;          // How many messages in the conversation
  tags: string[];                // Topic tags
  projectId: string;             // Project association (optional)
  interactionTone: string;       // "collaborative", "debugging", "brainstorming"
  createdAt: string;             // When the session happened
  duration: string;              // How long ("2 hours", "45 minutes")
  embeddingDim: number | null;   // Dimension of the transcript embedding
}
```

New SQL:
```sql
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  transcript TEXT NOT NULL,
  message_count INTEGER DEFAULT 0,
  project_id TEXT DEFAULT '',
  interaction_tone TEXT DEFAULT '',
  duration TEXT DEFAULT '',
  embedding TEXT,                 -- JSON array (embedding of summary + key phrases)
  embedding_dim INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episode_tags (
  episode_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (episode_id, tag),
  FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE
);
```

### 1B. Link memories to episodes

Add column to memories table:
```sql
ALTER TABLE memories ADD COLUMN episode_id TEXT DEFAULT NULL;
```

This lets a memory point back to "this fact came from this conversation."

### 1C. Update `src/storage/db.ts`

Add migration for the new tables + the episode_id column on memories.

---

## Part 2: Episode Storage — `src/core/episodes.ts` (NEW FILE)

### Functions:

**`saveEpisode(input: SaveEpisodeInput, config: Config): Promise<Episode>`**
- Generate UUID
- Store transcript in episodes table
- Generate embedding of the summary (NOT the full transcript — summaries are shorter and more searchable)
- If no summary provided, use the first 500 chars of transcript as the summary
- Store tags in episode_tags table
- Return Episode object

**`getEpisode(id: string, config: Config): Promise<Episode | null>`**
- Fetch by ID with tags joined

**`listEpisodes(config: Config, options?: { limit?: number; projectId?: string }): Promise<Episode[]>`**
- List episodes sorted by created_at desc
- Optional project filter

**`deleteEpisode(id: string, config: Config): Promise<boolean>`**
- Delete episode + cascade tags

**`searchEpisodes(query: string, config: Config, options?: { limit?: number }): Promise<EpisodeSearchResult[]>`**
- Generate query embedding
- Compare against episode embeddings (same cosine similarity as memories)
- Return results with score
- ALSO do a text search on transcript content as fallback (for exact phrase matching)

**`generatePrimer(config: Config, options?: { projectId?: string }): Promise<string>`**
- Get most recent episode
- Calculate time since last session ("2 hours ago", "yesterday", "3 days ago")
- Build a primer string:
  ```
  # Continuing Session
  *Last session: 2 hours ago*
  
  **Previous session**: [summary]
  **Topics**: [tags]
  **Duration**: [duration]
  
  Memories from that session will surface as relevant.
  ```
- Keep it minimal — follow RLabs philosophy of "gentle orientation, not information overload"

### Input types:

```typescript
export interface SaveEpisodeInput {
  transcript: string;           // Full conversation text (required)
  label?: string;               // e.g., "Lucid project kickoff"
  summary?: string;             // Brief summary (auto-generated if omitted)
  tags?: string[];              // Topic tags
  projectId?: string;           // Project association
  interactionTone?: string;     // "collaborative", "debugging", etc.
  duration?: string;            // "2 hours", "45 minutes"
  memoryIds?: string[];         // Link existing memories to this episode
}

export interface EpisodeSearchResult extends Episode {
  score: number;
  matchType: 'semantic' | 'text';  // How was this found
}
```

---

## Part 3: CLI Commands — `src/cli/session.ts` (NEW FILE)

Commander subcommand group: `lucid session <subcommand>`

### `lucid session save [options]`
```
Options:
  --file <path>          Read transcript from file
  --text <string>        Pass transcript text directly
  --label <label>        Session label (e.g., "Lucid kickoff")
  --summary <text>       Brief summary
  --tags <tags>          Comma-separated tags
  --project <id>         Project association
  --tone <tone>          Interaction tone
  --duration <duration>  Session duration
  --link <memoryIds>     Comma-separated memory IDs to link
  --json                 Output as JSON

If no --file or --text, reads from stdin (supports piping).
```

Example usage:
```bash
# Save from file
lucid session save --file conversation.md --label "Lucid day 1" --tags lucid,architecture

# Pipe from stdin
cat transcript.txt | lucid session save --label "Debug session" --tags debugging

# Agent usage (typical)
lucid session save --text "Human: ... Assistant: ..." --label "TamaPal review" --summary "Discussed design polish needs" --tags tamapal,design --project tamapal
```

### `lucid session search <query> [options]`
```
Options:
  -n, --limit <n>        Max results (default: 5)
  --json                 Output as JSON

Output format:
  Found 2 sessions:

    [0.72] Lucid project kickoff (March 16, 2026)
    → 45 messages | 4 hours | Tags: lucid, architecture, local-first
    Summary: Built Lucid from scratch. Pivoted to local-first after Victoria questioned API keys.

    [0.58] TamaPal design review (March 15, 2026)
    → 12 messages | 30 min | Tags: tamapal, design
    Summary: Reviewed MVP, identified design polish needs.
```

### `lucid session list [options]`
```
Options:
  -n, --limit <n>        Max results (default: 10)
  --project <id>         Filter by project
  --json                 Output as JSON

Output format:
  3 sessions:

    [March 16] Lucid project kickoff
    45 messages | 4 hours | Tags: lucid, architecture

    [March 15] TamaPal design review
    12 messages | 30 min | Tags: tamapal, design

    [March 15] Morning planning
    8 messages | 15 min | Tags: planning, operations
```

### `lucid session primer [options]`
```
Options:
  --project <id>         Filter by project
  --json                 Output as JSON (returns the primer object)

Output (plain text, designed to be injected into agent context):
  # Continuing Session
  *Last session: 2 hours ago (March 16, 2026)*

  **Previous session**: Built Lucid from scratch with smart recall algorithm. Victoria drove the local-first pivot.
  **Topics**: lucid, architecture, local-first, smart-recall
  **Duration**: 4 hours

  Memories from that session will surface as relevant.
```

### `lucid session show <id>`
```
Shows full episode details including transcript excerpt.
```

### Register in `src/cli/index.ts`
Add the session command group to the program.

---

## Part 4: Update Existing Commands

### 4A. Update `lucid recall` output

When a memory has an `episode_id`, show which session it came from:
```
  [0.82] We chose TypeScript with Bun
  → Selected due to: Strong trigger phrase match (0.90)
  → From session: "Lucid project kickoff" (March 16)
  tags: tech-stack | importance: 0.9 | TECHNICAL_DECISION
```

### 4B. Update `lucid add`

Add `--episode <id>` option to link a memory to an existing episode:
```bash
lucid add "We chose TypeScript" --tags tech --episode abc123
```

### 4C. Update `lucid status`

Show episode stats:
```
  Memories:     9
  Episodes:     3
  Embedding:    local (Xenova/all-MiniLM-L6-v2)
```

---

## Part 5: Tests

### 5A. New file: `tests/episodes.test.ts`

- saveEpisode: creates episode with all fields + tags + embedding
- saveEpisode: auto-generates summary from transcript if not provided
- getEpisode: retrieves by ID with tags
- getEpisode: returns null for non-existent
- deleteEpisode: removes episode + cascades tags
- listEpisodes: returns sorted by created_at desc
- listEpisodes: filters by projectId
- searchEpisodes: finds by semantic similarity
- searchEpisodes: returns empty for irrelevant query
- generatePrimer: returns formatted primer text
- generatePrimer: handles no episodes gracefully
- generatePrimer: calculates correct time ago
- memory-episode linking: memory with episode_id shows episode info

### 5B. Update existing tests

- `tests/memory.test.ts`: test episode_id field on addMemory
- `tests/integration.test.ts`: test save episode → add memory with link → recall shows episode

---

## Part 6: Things NOT to Change

- **Search algorithm** (`src/core/search.ts`) — smart recall stays the same
- **Embedder** — same local embeddings
- **Curator** — stays optional
- **Config** — no new config needed
- **Existing CLI commands** — init, config, curate, forget all unchanged

---

## File Change Summary

| File | Change Type | Scope |
|------|------------|-------|
| `src/storage/schema.ts` | MODIFY | Add Episode interface, SQL CREATE for episodes + episode_tags |
| `src/storage/db.ts` | MODIFY | Migration for new tables + episode_id column |
| `src/core/episodes.ts` | **NEW** | save, get, list, delete, search, generatePrimer |
| `src/cli/session.ts` | **NEW** | session save/search/list/primer/show commands |
| `src/cli/index.ts` | MODIFY | Register session command group |
| `src/cli/add.ts` | MODIFY | Add --episode option |
| `src/cli/recall.ts` | MODIFY | Show episode source on results |
| `src/cli/status.ts` | MODIFY | Show episode count |
| `src/core/memory.ts` | MODIFY | AddMemoryInput gets episodeId field |
| `src/types/index.ts` | MODIFY | Re-export Episode types |
| `tests/episodes.test.ts` | **NEW** | Episode CRUD + search + primer tests |
| `tests/memory.test.ts` | MODIFY | Test episodeId field |
| `tests/integration.test.ts` | MODIFY | Full episode → memory → recall pipeline |

---

## Checklist for Robin

- [ ] Update `src/storage/schema.ts` — Episode interface, Episode SQL, episode_tags SQL
- [ ] Update `src/storage/db.ts` — migration for episodes table + episode_tags + episode_id on memories
- [ ] Create `src/core/episodes.ts` — saveEpisode, getEpisode, listEpisodes, deleteEpisode, searchEpisodes, generatePrimer
- [ ] Create `src/cli/session.ts` — session save/search/list/primer/show with all options
- [ ] Update `src/cli/index.ts` — register session command
- [ ] Update `src/cli/add.ts` — add --episode option
- [ ] Update `src/cli/recall.ts` — show episode source when available
- [ ] Update `src/cli/status.ts` — show episode count
- [ ] Update `src/core/memory.ts` — add episodeId to AddMemoryInput + INSERT + rowToMemory
- [ ] Update `src/types/index.ts` — re-export new types
- [ ] Create `tests/episodes.test.ts` — comprehensive episode tests
- [ ] Update `tests/memory.test.ts` — episodeId field tests
- [ ] Update `tests/integration.test.ts` — episode → memory → recall pipeline
- [ ] `bun run lint` — must pass
- [ ] `bun test` — all tests pass
- [ ] Manual test:
  - [ ] `lucid session save --text "Human: hi\nAssistant: hello" --label "Test" --tags test`
  - [ ] `lucid session list`
  - [ ] `lucid session search "hello"`
  - [ ] `lucid session primer`
  - [ ] `lucid add "test fact" --episode <id>` then `lucid recall "test"` shows episode source
- [ ] Commit: "Episodic memory: session save, search, primer, memory linking"
- [ ] Push to origin main
