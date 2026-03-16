# 🧠 Lucid

**CLI-first memory layer for AI agents.** Auto-curates memories from conversations, provides semantic recall — works with any LLM runtime.

<!-- badges -->
[![npm version](https://img.shields.io/npm/v/lucid-memory)](https://www.npmjs.com/package/lucid-memory)
[![license](https://img.shields.io/npm/l/lucid-memory)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-28%20passing-brightgreen)]()

---

## Features

- 🧠 **Auto-curation** — Feed in conversation transcripts, get structured memories extracted by LLM
- 🔍 **Semantic recall** — Search your memory store with natural language, powered by vector similarity
- 🔌 **Runtime-agnostic** — Works with any AI agent that can call a CLI (OpenClaw, Claude Code, Codex, Gemini CLI)
- 💾 **Local-first** — SQLite storage via `bun:sqlite`. Your data stays on your machine

## Quick Start

> **Requires [Bun](https://bun.sh) ≥ 1.0** — Lucid uses `bun:sqlite` for storage.

```bash
# Install globally
bun install -g lucid-memory

# Initialize
lucid init

# Curate memories from a conversation
lucid curate --file conversation.md
cat transcript.txt | lucid curate

# Search your memories
lucid recall "what tech stack did we choose?"

# List all memories
lucid list
lucid list --tag technical-decision

# Delete a memory
lucid forget <id>
```

## Configuration

Lucid stores its config at `~/.lucid/config.json`. Created automatically on `lucid init`.

### Environment Variables

| Variable | Required | Used For |
|---|---|---|
| `OPENAI_API_KEY` | Yes | Embeddings (text-embedding-3-small) + optional curation |
| `ANTHROPIC_API_KEY` | Optional | Curation via Claude (preferred if set) |

Set them in your shell profile or `.env`:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."   # optional
```

### Config File

```json
{
  "version": "0.1.0",
  "dataDir": "~/.lucid",
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  },
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small"
  }
}
```

## How It Works

```
Conversation transcript
        │
        ▼
   ┌─────────┐    LLM extracts structured memories
   │  Curate  │──▶ (content, tags, importance, source)
   └─────────┘
        │
        ▼
   ┌─────────┐    OpenAI text-embedding-3-small
   │  Embed   │──▶ generates vector for each memory
   └─────────┘
        │
        ▼
   ┌─────────┐    SQLite stores text + vector together
   │  Store   │──▶ ~/.lucid/memories.db
   └─────────┘
        │
        ▼
   ┌─────────┐    Cosine similarity over stored vectors
   │  Recall  │──▶ returns ranked results
   └─────────┘
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                   CLI Layer                      │
│  init · curate · recall · list · status · forget │
├─────────────────────────────────────────────────┤
│                  Core Logic                      │
│  curator · memory · search · embedder            │
├──────────────────────┬──────────────────────────┤
│     SQLite Store     │     Vector Search         │
│     (bun:sqlite)     │   (cosine similarity)     │
├──────────────────────┴──────────────────────────┤
│              Configuration Layer                 │
│          ~/.lucid/config.json                    │
└─────────────────────────────────────────────────┘
```

### Data Directory

```
~/.lucid/
├── config.json       # User configuration
├── memories.db       # SQLite database (text + vectors)
├── episodes/         # Indexed conversation transcripts
└── vectors/          # Vector index files
```

## CLI Reference

| Command | Description | Key Options |
|---|---|---|
| `lucid init` | Initialize data directory and database | — |
| `lucid status` | Show config, data dir, memory count | — |
| `lucid curate` | Extract memories from a transcript | `--file <path>`, `--text <string>`, `--json`, `--dry-run` |
| `lucid recall <query>` | Semantic search over memories | `-n <limit>`, `--json`, `--min-score <threshold>` |
| `lucid list` | List stored memories | `--tag <tag>`, `-n <limit>`, `--json` |
| `lucid forget <id>` | Delete a memory by ID | — |

## Roadmap

| Version | Focus | Status |
|---|---|---|
| **v0.1** | Core memory CRUD + semantic search + CLI | ✅ Released |
| **v0.2** | Episode indexing + MCP server mode | 📋 Planned |
| **v0.3** | File search + transcript import | 📋 Planned |
| **v1.0** | Cloud sync + team memories | 📋 Planned |

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests (28 passing)
bun run lint         # Type-check (tsc --noEmit)
bun bin/lucid.ts     # Run CLI in dev mode
```

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/thing`)
3. Make sure `bun test` and `bun run lint` pass
4. Open a PR

## License

MIT — see [LICENSE](./LICENSE)
