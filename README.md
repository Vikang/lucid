# 🧠 Lucid

**CLI-first memory layer for AI agents.** Store memories, embed them locally, search them fast — no API keys needed.

<!-- badges -->
[![npm version](https://img.shields.io/npm/v/lucid-memory)](https://www.npmjs.com/package/lucid-memory)
[![license](https://img.shields.io/npm/l/lucid-memory)](./LICENSE)

---

## Features

- 🧠 **Local-first** — No API keys needed for core features. Embeddings run locally via transformers.js
- 🔍 **Semantic recall** — Search your memory store with natural language, powered by vector similarity
- 🔌 **Runtime-agnostic** — Works with any AI agent that can call a CLI (OpenClaw, Claude Code, Codex, Gemini CLI)
- 💾 **SQLite storage** — All data stays on your machine via `bun:sqlite`
- 📝 **Manual + auto** — Add memories directly or auto-curate from transcripts (optional, needs LLM)

## Quick Start

> **Requires [Bun](https://bun.sh) ≥ 1.0** — Lucid uses `bun:sqlite` for storage.

```bash
# Install globally
bun install -g lucid-memory

# Initialize (no API keys needed!)
lucid init

# Add memories
lucid add "We chose TypeScript for the project" --tags tech-stack -i 0.9
lucid add "Always use semantic versioning" --tags workflow

# Search semantically
lucid recall "what language are we using?"

# List all memories
lucid list

# Delete a memory
lucid forget <id>

# Check status
lucid status

# Optional: auto-curate from conversations (needs Ollama or API key)
lucid config set llm.provider ollama
lucid curate --file conversation.md
```

## Configuration

Lucid stores its config at `~/.lucid/config.json`. Created automatically on `lucid init`.

### Default (zero-config)

Everything works out of the box — no API keys, no cloud services:

```json
{
  "version": "0.1.0",
  "dataDir": "~/.lucid",
  "embedding": {
    "provider": "local",
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "llm": {
    "provider": "none",
    "model": ""
  }
}
```

The local embedding model (~80MB) downloads automatically on first use.

### Optional: Configure API Providers

For `lucid curate` (auto-extraction from transcripts), you need an LLM:

```bash
# Option 1: Ollama (free, local)
lucid config set llm.provider ollama
# Make sure Ollama is running: ollama serve

# Option 2: Anthropic API
lucid config set llm.provider anthropic
lucid config set llm.model claude-sonnet-4-20250514
export ANTHROPIC_API_KEY="sk-ant-..."

# Option 3: OpenAI API
lucid config set llm.provider openai
lucid config set llm.model gpt-4o
export OPENAI_API_KEY="sk-..."

# Option 4: Gemini API
lucid config set llm.provider gemini
lucid config set llm.model gemini-2.0-flash
export GEMINI_API_KEY="..."
```

For higher-quality embeddings (optional):

```bash
# OpenAI embeddings
lucid config set embedding.provider openai
lucid config set embedding.model text-embedding-3-small
export OPENAI_API_KEY="sk-..."

# Gemini embeddings
lucid config set embedding.provider gemini
lucid config set embedding.model text-embedding-004
export GEMINI_API_KEY="..."
```

> **Note:** Switching embedding providers means new memories will have different vector dimensions. Lucid handles this gracefully — it only compares vectors of the same dimension during search.

## How It Works

```
  lucid add "memory text"          lucid curate --file transcript.md
        │                                  │
        │                           ┌──────┴──────┐
        │                           │   LLM       │ (optional)
        │                           │  extracts   │
        │                           │  memories   │
        │                           └──────┬──────┘
        │                                  │
        ▼                                  ▼
   ┌─────────┐    Local transformers.js (default)
   │  Embed   │──▶ or OpenAI/Gemini API (optional)
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
┌──────────────────────────────────────────────────────┐
│                     CLI Layer                         │
│  init · add · curate · recall · list · status · forget│
├──────────────────────────────────────────────────────┤
│                    Core Logic                         │
│  embedder · memory · search · curator                 │
├──────────────────────┬───────────────────────────────┤
│     SQLite Store     │     Vector Search              │
│     (bun:sqlite)     │   (cosine similarity)          │
├──────────────────────┴───────────────────────────────┤
│              Configuration Layer                      │
│          ~/.lucid/config.json                         │
└──────────────────────────────────────────────────────┘
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
| `lucid add <content>` | Add a memory manually | `-t/--tags`, `-i/--importance`, `--type`, `--source`, `--json` |
| `lucid curate` | Extract memories from a transcript (needs LLM) | `--file <path>`, `--text <string>`, `--json`, `--dry-run` |
| `lucid recall <query>` | Semantic search over memories | `-n <limit>`, `--json`, `--min-score <threshold>` |
| `lucid list` | List stored memories | `--tag <tag>`, `-n <limit>`, `--json` |
| `lucid forget <id>` | Delete a memory by ID | — |
| `lucid config show` | Print current config | — |
| `lucid config set <key> <val>` | Set a config value | — |
| `lucid config reset` | Reset config to defaults | — |

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests
bun run lint         # Type-check (tsc --noEmit)
bun bin/lucid.ts     # Run CLI in dev mode
```

## License

MIT — see [LICENSE](./LICENSE)
