# Changelog

## [0.3.0] — 2026-03-16

### Added
- **OpenClaw Import** — `lucid import openclaw` bulk imports past conversations
  - Scans all agent sessions (zoro, robin, main)
  - Security sanitization: redacts API keys, OAT tokens, Bearer tokens, npm tokens
  - Strips tool output and system metadata — only human + AI text imported
  - Channel detection and auto-labeling
  - Duplicate prevention via source session tracking
  - Options: --dry-run, --agent, --channel, --since, --yes, --verbose, --json
  - Confirmation prompt with consent summary (skippable with --yes)
- 34 new tests (security, sanitization, parser, engine)


## [0.2.0] — 2026-03-16

### Added
- **Episodic Memory** — store and search past conversations
  - `lucid session save` — save conversation transcripts with labels, tags, summaries
  - `lucid session search` — semantic search across past conversations
  - `lucid session list` — browse past sessions
  - `lucid session primer` — generate "last time we talked..." context for agents
  - `lucid session show` — view full episode details
  - Memory → episode linking: memories track which conversation they came from
- **Smart Recall** — ported RLabs' 10-dimension scoring algorithm
  - Trigger phrase matching (fuzzy, with plural/substring handling)
  - Importance weighting, temporal relevance, context type alignment
  - Tag matching, question type matching, emotional resonance
  - Problem-solution pattern detection, action-required boost
  - Gatekeeper: filters irrelevant results (relevance < 0.05 or score < 0.3)
  - 3-tier selection: MUST → SHOULD → CONTEXT (diversity)
  - Selection reasoning in output ("Selected due to: ...")
- **Local-First Architecture** — zero API keys needed for core features
  - Local embeddings via transformers.js + all-MiniLM-L6-v2 (384d, ~80MB)
  - Model downloads lazily on first use
  - Default config: local embeddings, no LLM required
- `lucid add` — manually add memories (primary interface for agents)
  - Rich metadata: --triggers, --questions, --emotion, --problem-solution, --confidence, --action-required, --domain, --episode
- `lucid config` — view and modify configuration (show/set/reset)
- Ollama as local LLM provider for optional curate feature
- Gemini provider support (embedding + LLM)
- Comprehensive error handling with friendly messages (no stack traces)
- Embedding dimension safety (mixed vector sizes don't break search)
- 143 tests

### Changed
- Default embedding provider: `local` (was `openai`)
- Default LLM provider: `none` (was `anthropic`) — curate is now optional
- `lucid curate` marked as optional power feature with helpful setup guide

## [0.1.0] — 2026-03-16

### Added
- `lucid init` — Initialize data directory and SQLite database
- `lucid status` — Show configuration and memory count
- `lucid curate` — Extract memories from conversation transcripts via LLM
- `lucid recall` — Semantic search over stored memories
- `lucid list` — List and filter stored memories
- `lucid forget` — Delete memories by ID
- OpenAI embedding support (text-embedding-3-small)
- Anthropic + OpenAI LLM support for curation
- SQLite storage with embedded vectors
- 28 tests

