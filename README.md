# Lucid

> CLI-first unified memory layer for AI agents.

Auto-curates memories from conversations, provides semantic recall — works with any LLM runtime (OpenClaw, Claude Code, Codex, Gemini CLI).

## What It Does

- **🧠 Auto-curation** — Feed in conversation transcripts, get structured memories extracted by LLM
- **🔍 Semantic recall** — Search your memory store with natural language, powered by vector similarity
- **🔌 Runtime-agnostic** — Works with any AI agent that can call a CLI: OpenClaw, Claude Code, Codex, Gemini CLI

## Quick Start

```bash
# Install
bun install

# Initialize Lucid
bun bin/lucid.ts init

# Check status
bun bin/lucid.ts status

# More commands coming in v0.1...
bun bin/lucid.ts curate    # Extract memories from transcripts
bun bin/lucid.ts recall    # Semantic memory search
bun bin/lucid.ts list      # Browse stored memories
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   CLI Layer                      │
│  init · curate · recall · list · status          │
├─────────────────────────────────────────────────┤
│                  Core Logic                      │
│  curator · memory · search · embedder            │
├──────────────────────┬──────────────────────────┤
│     SQLite Store     │     Vector Index          │
│   (better-sqlite3)   │       (vectra)            │
├──────────────────────┴──────────────────────────┤
│              Configuration Layer                 │
│          ~/.lucid/config.json                    │
└─────────────────────────────────────────────────┘
```

## Data Directory

```
~/.lucid/
├── config.json       # User configuration
├── memories.db       # SQLite database
├── episodes/         # Indexed conversation transcripts
└── vectors/          # Vector index files
```

## Roadmap

| Version | Focus | Status |
|---------|-------|--------|
| **v0.1** | Core memory CRUD + semantic search + CLI | 🚧 In Progress |
| **v0.2** | MCP server mode + episode indexing | 📋 Planned |
| **v0.3** | Cloud sync + multi-device | 📋 Planned |
| **v1.0** | Stable release + npm publish | 📋 Planned |

## Development

```bash
bun install          # Install dependencies
bun run dev          # Run CLI in dev mode
bun test             # Run tests
bun run build        # Bundle for distribution
bun run lint         # Type-check (tsc --noEmit)
```

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/thing`)
3. Follow the code style in [AGENTS.md](./AGENTS.md)
4. Make sure `bun run lint` passes
5. Open a PR

## License

MIT — see [LICENSE](./LICENSE)
