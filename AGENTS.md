# AGENTS.md — Lucid

> CLI-first unified memory layer for AI agents. Auto-curates memories from conversations, provides semantic recall — works with any LLM runtime (OpenClaw, Claude Code, Codex, Gemini CLI).

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun (v1.2+)
- **CLI Framework:** Commander.js
- **Database:** SQLite via better-sqlite3
- **Vector Search:** vectra (local vector index)
- **Embedding:** Configurable — transformers.js (local) or OpenAI API
- **LLM (curation):** Configurable — Ollama (local) or Claude/OpenAI API
- **Testing:** Bun test (built-in)
- **Package:** npm (`@lucid-memory/cli` or `lucid-memory`)

## Project Structure

```
lucid/
├── src/
│   ├── cli/              # CLI command definitions (Commander.js)
│   │   ├── index.ts      # Entry point — registers all commands
│   │   ├── init.ts       # lucid init
│   │   ├── curate.ts     # lucid curate
│   │   ├── recall.ts     # lucid recall
│   │   ├── list.ts       # lucid list
│   │   └── status.ts     # lucid status
│   ├── core/             # Business logic (no CLI deps)
│   │   ├── curator.ts    # Transcript → memory extraction (LLM)
│   │   ├── memory.ts     # Memory CRUD operations
│   │   ├── search.ts     # Semantic search over memories
│   │   └── embedder.ts   # Embedding generation (configurable provider)
│   ├── storage/          # Data layer
│   │   ├── db.ts         # SQLite setup + migrations
│   │   ├── vectors.ts    # Vector index operations
│   │   └── schema.ts     # Table definitions + types
│   ├── config/           # Configuration
│   │   └── index.ts      # Load/save ~/.lucid/config.json
│   ├── types/            # Shared TypeScript types
│   │   └── index.ts
│   └── utils/            # Helpers
│       ├── logger.ts     # Structured logging (stderr for logs, stdout for output)
│       └── transcript.ts # Transcript parsing (stdin, file, pipe)
├── tests/
│   ├── curator.test.ts
│   ├── memory.test.ts
│   ├── search.test.ts
│   └── cli.test.ts
├── bin/
│   └── lucid.ts          # CLI entry — #!/usr/bin/env bun
├── package.json
├── tsconfig.json
├── bunfig.toml
├── README.md
├── LICENSE
└── AGENTS.md
```

## Commands

```bash
bun install          # Install dependencies
bun run dev          # Run CLI in dev mode (bun bin/lucid.ts)
bun test             # Run all tests
bun run build        # Bundle for npm (bun build)
bun run lint         # Type-check (tsc --noEmit)
```

## Code Style

- **Naming:** camelCase for variables/functions, PascalCase for types/interfaces, UPPER_SNAKE for constants
- **Exports:** Named exports only (no default exports)
- **Functions:** Prefer pure functions. Side effects only at boundaries (CLI handlers, DB operations)
- **Errors:** Use typed error classes extending `LucidError` base. Never throw raw strings
- **Async:** Use async/await. No callbacks. No .then() chains
- **Logging:** All logs go to stderr (`console.error`). All output goes to stdout (`console.log`). This is critical for piping
- **Config:** Always use the config loader (`src/config/index.ts`). Never hardcode paths
- **Types:** No `any`. Use `unknown` and narrow. All function signatures fully typed

## Architecture Rules

1. **CLI layer is thin** — Commands parse args and call core functions. No business logic in CLI handlers
2. **Core is framework-agnostic** — No Commander.js imports in `src/core/`. Core functions accept plain objects, return plain objects
3. **Storage is swappable** — All DB access goes through storage layer. Core never imports better-sqlite3 directly
4. **Config is centralized** — All paths, defaults, provider settings live in `src/config/`
5. **Stdout is sacred** — Only structured output (JSON or formatted text) goes to stdout. Everything else goes to stderr

## Data Directory

```
~/.lucid/
├── config.json       # User configuration
├── memories.db       # SQLite database (memories + metadata)
├── episodes/         # Indexed conversation transcripts
└── vectors/          # Vector index files (vectra)
```

## Memory Schema

```typescript
interface Memory {
  id: string;                    // UUID v4
  content: string;               // The extracted memory text
  importance: number;            // 0.0 - 1.0 (LLM-assigned)
  tags: string[];                // Categorization tags
  contextType: ContextType;      // TECHNICAL_DECISION | LEARNED_PREFERENCE | etc.
  triggerPhrases: string[];      // Phrases that should surface this memory
  sourceSession: string;         // ISO timestamp of source conversation
  temporalRelevance: 'persistent' | 'short-term' | 'expiring';
  createdAt: string;             // ISO timestamp
  lastAccessed: string | null;   // ISO timestamp
  accessCount: number;           // Usage tracking for relevance
}
```

## Boundaries

- **DO NOT** add any cloud/sync features — that's v0.3+
- **DO NOT** add MCP server mode — that's v0.2
- **DO NOT** add episode indexing — that's v0.2
- **DO NOT** use ChromaDB, Pinecone, or any external vector DB
- **DO NOT** require Docker or any containerization
- **DO NOT** add a web UI
- **DO NOT** hardcode any API keys — always use config or env vars
- **DO NOT** write to stdout unless it's the command's output

## Example: How a CLI Command Should Look

```typescript
// src/cli/recall.ts
import { Command } from 'commander';
import { searchMemories } from '../core/search';
import { loadConfig } from '../config';
import { logger } from '../utils/logger';

export const recallCommand = new Command('recall')
  .description('Search memories semantically')
  .argument('<query>', 'Search query')
  .option('-n, --limit <n>', 'Max results', '5')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    const config = await loadConfig();
    logger.debug(`Searching for: ${query}`);
    
    const results = await searchMemories(query, {
      limit: parseInt(opts.limit),
      config,
    });

    if (opts.json) {
      console.log(JSON.stringify(results, null, 2));
    } else {
      for (const r of results) {
        console.log(`[${r.score.toFixed(2)}] ${r.content}`);
        console.log(`  tags: ${r.tags.join(', ')}`);
        console.log();
      }
    }
  });
```
