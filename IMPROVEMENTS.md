# Lucid v0.4.0 — Improvement Plan

## Issues (from Victoria's feedback)

### Issue 1: Memories Too Generic
**Problem:** Memories like "TamaPal current state: MVP with egg shell UI..." are flat summaries. Git log already tells you this. Need richer, structured memories — decisions made, blockers hit, lessons learned.

**Root Cause:** The extraction prompt in `src/core/curator.ts` asks for generic "facts" without pushing for decision context, reasoning, or lessons.

**Solution:**
- Rewrite `EXTRACTION_PROMPT` to emphasize decision context, trade-offs, blockers, and lessons
- Add a `metadata` JSON field to memories for structured sub-fields (decision rationale, alternatives considered, blockers encountered)
- When curating, prioritize "why" over "what" — the reasoning behind decisions, not just the outcome

### Issue 2: Deduplication with MEMORY.md
**Problem:** Overlap between MEMORY.md and Lucid. Lucid should store things MEMORY.md can't — too granular, too ephemeral, or too project-specific.

**Solution:**
- Add semantic deduplication on `lucid add` — before inserting, check cosine similarity against existing memories. If > 0.92 similarity, warn and offer to merge/skip
- Add a `lucid dedup` command that scans all memories and flags/merges near-duplicates
- Add content hashing for exact-match dedup (fast path)

### Issue 3: Cross-Agent Value (already architecturally supported, needs polish)
**Problem:** The real value is cross-agent + cross-session, not within a single well-configured agent. Need agent attribution so you know WHO saved WHAT.

**Solution:**
- Add `source_agent` column to memories table (which agent created this memory)
- Add `--agent` flag to `lucid add` and auto-detect from environment (`OPENCLAW_AGENT_ID`)
- Add `--by <agent>` filter to `lucid recall` and `lucid list`
- Show agent attribution in recall output

### Issue 4: Recall Scoring Too Predictable
**Problem:** Everything returned is obvious — confirms what's already in context. Want Lucid to surface "the thing I forgot I knew."

**Solution:**
- Add **serendipity boost** — memories with low access count but decent relevance get boosted
- Add **recency penalty for over-accessed** — if accessed 10+ times recently, slight penalty (you already know this)
- Add **inverse popularity** — memories rarely surfaced get a small boost when they cross the relevance threshold
- Add **temporal surprise** — old memories (30+ days) that match get a "rediscovery" boost
- Tune the composite formula: reduce importance weight (currently 0.20), increase vector + trigger weights

## Implementation Workstreams

### WS1: Richer Memory Extraction (curator.ts)
- Rewrite extraction prompt
- Add structured metadata support
- Update tests

### WS2: Semantic Deduplication (new core/dedup.ts)
- Content hash dedup (exact match fast path)
- Cosine similarity dedup (semantic near-match)
- `lucid dedup` CLI command
- Auto-dedup on `lucid add` with --no-dedup flag to bypass
- Update tests

### WS3: Agent Attribution (schema + memory.ts + CLI)
- Schema migration: add `source_agent` column
- Update `addMemory()` to accept `sourceAgent`
- Update CLI `add` command with `--agent` flag
- Auto-detect agent from `OPENCLAW_AGENT_ID` env var
- Show agent in `recall` and `list` output
- Update tests

### WS4: Serendipity Scoring (search.ts)
- Add serendipity dimension to scoring
- Add recency-of-access penalty
- Add inverse popularity boost
- Add temporal surprise (old memory rediscovery)
- Retune composite weights
- Update tests
