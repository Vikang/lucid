# Implementation Plan: `lucid import openclaw`

> **Goal:** Bulk import past conversations from OpenClaw session files into Lucid
> **Data source:** `~/.openclaw/agents/*/sessions/*.jsonl`
> **Security priority:** HIGH — session files contain sensitive data (API keys, tokens, emails)

---

## Data Landscape (from actual analysis)

### What exists
- **3 agents:** zoro (21 sessions), robin (2), main (2)
- **Total:** ~25 session files, ~27MB
- **Format:** JSONL — one JSON object per line
- **Structure per line:**
  ```jsonl
  {"type":"session","id":"...","timestamp":"...","cwd":"..."}
  {"type":"model_change",...}
  {"type":"message","id":"...","timestamp":"...","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
  {"type":"message","id":"...","timestamp":"...","message":{"role":"assistant","content":[{"type":"text","text":"..."}]}}
  ```
- **Channels found:** #tamapal, #lucid, #command, #morning, #evening, #project, #crew, #learning, webchat
- **Message types:** message (user/assistant), toolResult, custom, session, model_change, thinking_level_change

### Sensitive data found
- ⚠️ **OAT tokens** (sk-ant-oat-*) — found in 1 session file (10 occurrences)
- ⚠️ **Email addresses** — found in conversations ([REDACTED])
- ⚠️ **Tool output** — contains file contents, system info, config dumps
- ⚠️ **API error responses** — contain headers, request IDs, billing URLs

---

## Security Model

### Principle: Sanitize on import, never store raw credentials

### What gets imported
- **User messages** — the human side of conversations (text content only)
- **Assistant messages** — the AI responses (text content only)
- **Timestamps** — when each message was sent
- **Channel/source** — which Discord channel or webchat

### What gets EXCLUDED (security filter)
1. **Tool results** (type: "toolResult") — contain raw command output, file contents, system info
2. **System messages** (type: "custom", "model_change", etc.) — internal metadata
3. **Any text matching sensitive patterns:**
   - API keys: `sk-[a-zA-Z0-9]{20,}`
   - OAT tokens: `sk-ant-oat[a-zA-Z0-9_-]+`
   - Bearer tokens: `Bearer [a-zA-Z0-9_-]{20,}`
   - npm tokens: `npm_[a-zA-Z0-9]+`
   - Generic secrets: lines containing "apiKey", "token", "secret", "password" + a long value
4. **Embedded JSON metadata blocks** — the conversation_info and sender metadata that OpenClaw prepends to user messages (strip these, keep only the actual user text)

### Sanitization function
```typescript
function sanitizeText(text: string): string {
  // Remove OpenClaw metadata blocks
  text = text.replace(/Conversation info \(untrusted metadata\):[\s\S]*?```\n\n/g, '');
  text = text.replace(/Sender \(untrusted metadata\):[\s\S]*?```\n\n/g, '');
  
  // Redact sensitive patterns
  text = text.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED_API_KEY]');
  text = text.replace(/sk-ant-oat[a-zA-Z0-9_-]+/g, '[REDACTED_TOKEN]');
  text = text.replace(/Bearer [a-zA-Z0-9_-]{20,}/g, 'Bearer [REDACTED]');
  text = text.replace(/npm_[a-zA-Z0-9]{20,}/g, '[REDACTED_NPM_TOKEN]');
  
  return text;
}
```

### User consent flow
```
lucid import openclaw
> ⚠️  This will scan your OpenClaw session history and import conversations into Lucid.
> 
> What gets imported:
>   ✓ Your messages and AI responses (text only)
>   ✓ Timestamps and channel info
> 
> What is EXCLUDED:
>   ✗ Tool output and command results
>   ✗ API keys, tokens, and credentials (auto-redacted)
>   ✗ System metadata
> 
> Data stays 100% local — nothing leaves your machine.
> 
> Found 3 agents, 25 sessions across: #tamapal, #lucid, #command, #morning, #project
> 
> Import all? [y/n]:
```

If no TTY (piped/scripted), require `--yes` flag to skip confirmation.

---

## Part 1: Session Parser — `src/import/openclaw.ts` (NEW FILE)

### Functions:

**`discoverSessions(openclawDir?: string): Promise<DiscoveredSession[]>`**
- Default path: `~/.openclaw/agents/*/sessions/*.jsonl`
- Skip `.deleted` files
- For each file: read first line (session metadata), count messages, detect channels
- Return list of sessions with metadata

```typescript
interface DiscoveredSession {
  filePath: string;
  agentId: string;          // "zoro", "robin", "main"
  sessionId: string;        // UUID from filename
  timestamp: string;        // From session header
  messageCount: number;     // user + assistant messages
  channels: string[];       // Detected channels
  sizeBytes: number;        // File size
}
```

**`parseSession(filePath: string): Promise<ParsedSession>`**
- Read the JSONL file line by line
- Extract only type="message" lines where role is "user" or "assistant"
- Skip toolResult lines entirely
- For each message:
  - Extract text content (handle both string and array content formats)
  - Run sanitizeText() to strip metadata blocks and redact secrets
  - Record timestamp and role
- Detect channel from metadata blocks in user messages
- Return parsed session

```typescript
interface ParsedMessage {
  role: 'user' | 'assistant';
  content: string;           // Sanitized text
  timestamp: string;
}

interface ParsedSession {
  sessionId: string;
  agentId: string;
  channel: string;           // Best guess from metadata
  messages: ParsedMessage[];
  startTime: string;
  endTime: string;
  duration: string;          // Human-readable
}
```

**`sanitizeText(text: string): string`**
- Strip OpenClaw metadata blocks (Conversation info, Sender metadata)
- Redact API keys, tokens, credentials
- Trim whitespace
- Return clean text

**`sessionToTranscript(session: ParsedSession): string`**
- Convert ParsedMessage[] to readable transcript:
  ```
  Human: What should we build?
  
  Assistant: Let's build a memory tool for AI agents...
  ```

**`generateSessionSummary(session: ParsedSession): string`**
- Auto-generate a summary from the session (NO LLM — pure heuristic):
  - Take first user message as topic indicator
  - Count message exchanges
  - Extract channel name
  - Format: "Conversation in #channel (X messages, Y minutes). Started with: [first user message preview]"
- This is intentionally simple — the user can edit summaries later

**`generateSessionLabel(session: ParsedSession): string`**
- Auto-generate label from channel + date
- Format: "#channel session (Mar 16)" or "Webchat session (Mar 15)"

---

## Part 2: Import Engine — `src/import/engine.ts` (NEW FILE)

### Functions:

**`importOpenClaw(config: Config, options: ImportOptions): Promise<ImportResult>`**

```typescript
interface ImportOptions {
  openclawDir?: string;      // Override default path
  agents?: string[];         // Filter by agent (default: all)
  channels?: string[];       // Filter by channel (default: all)
  since?: string;            // Only sessions after this date
  dryRun?: boolean;          // Show what would be imported without doing it
  yes?: boolean;             // Skip confirmation prompt
  verbose?: boolean;         // Show per-session details
}

interface ImportResult {
  sessionsScanned: number;
  sessionsImported: number;
  sessionsSkipped: number;
  episodesCreated: number;
  memoriesExtracted: number;  // 0 for now — memories come from agent usage, not auto-extraction
  errors: string[];
}
```

The import flow:
1. Call `discoverSessions()` to find all sessions
2. Apply filters (agents, channels, since)
3. Show summary and ask for confirmation (unless --yes)
4. For each session:
   a. Call `parseSession()` to extract sanitized messages
   b. Skip if too few messages (< 3)
   c. Generate transcript, summary, label
   d. Call `saveEpisode()` from episodes.ts to store it
   e. Print progress
5. Return ImportResult

**IMPORTANT: This does NOT auto-extract memories.** It only saves episodes (conversation transcripts). Memory extraction happens when:
- The agent calls `lucid add` during future sessions
- The user manually adds memories
- (Future) The user runs `lucid curate` on an imported episode

Rationale: Auto-extracting memories requires LLM reasoning to decide what's important. That violates our "Lucid doesn't need to be smart" principle. The agent decides what's important, not the import tool.

---

## Part 3: CLI Command — `src/cli/import.ts` (NEW FILE)

```
lucid import openclaw [options]

Options:
  --path <dir>           Override OpenClaw directory (default: ~/.openclaw)
  --agent <agents>       Comma-separated agent filter (default: all)
  --channel <channels>   Comma-separated channel filter (default: all)
  --since <date>         Only sessions after this date (YYYY-MM-DD)
  --dry-run              Show what would be imported without doing it
  --yes                  Skip confirmation prompt
  --verbose              Show per-session details
  --json                 Output results as JSON
```

### Examples:
```bash
# Import everything
lucid import openclaw

# Dry run first
lucid import openclaw --dry-run

# Only TamaPal conversations
lucid import openclaw --channel tamapal

# Only last 3 days
lucid import openclaw --since 2026-03-14

# Only zoro agent, skip confirmation
lucid import openclaw --agent zoro --yes

# Scripted usage
lucid import openclaw --yes --json
```

### Output format:
```
Scanning OpenClaw sessions...

Found 25 sessions across 3 agents:

  Agent    Sessions  Channels
  zoro     21        #tamapal, #lucid, #command, #morning, #evening, #project
  robin     2        (subagent sessions)
  main      2        #webchat

⚠️  Security: Tool output and credentials will be excluded. Data stays local.

Import all 25 sessions? [y/n]: y

Importing...
  ✓ #tamapal session (Mar 15) — 45 messages, 2h 15m
  ✓ #command session (Mar 15) — 128 messages, 4h 30m
  ✓ #lucid session (Mar 16) — 81 messages, 6h 00m
  ✓ #morning session (Mar 16) — 12 messages, 15m
  ⏭ (subagent) robin session — skipped (< 3 user messages)
  ...

✅ Import complete
   Sessions scanned: 25
   Episodes created: 22
   Skipped: 3 (too few messages)
   
Run 'lucid session search "query"' to search across all imported conversations.
```

### Dry run output:
```
lucid import openclaw --dry-run

Scanning OpenClaw sessions...

Would import 22 sessions:

  [Mar 15] #command — 128 messages, 4h 30m, 2.2MB
  [Mar 15] #tamapal — 45 messages, 2h 15m, 656KB
  [Mar 16] #lucid — 81 messages, 6h 00m, 5.8MB
  ...

No changes made (dry run).
```

Register as subcommand in `src/cli/index.ts`.

---

## Part 4: Duplicate Detection

Prevent double-importing:
- Before saving an episode, check if an episode with the same `sourceSessionId` already exists
- Add `source_session_id` column to episodes table
- If found, skip with message: "Already imported: #channel session (Mar 16)"

Migration in db.ts:
```sql
ALTER TABLE episodes ADD COLUMN source_session_id TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_episodes_source ON episodes(source_session_id);
```

---

## Part 5: Tests — `tests/import.test.ts` (NEW FILE)

### Sanitization tests:
- sanitizeText strips OpenClaw metadata blocks
- sanitizeText redacts API keys (sk-...)
- sanitizeText redacts OAT tokens (sk-ant-oat-...)
- sanitizeText redacts Bearer tokens
- sanitizeText redacts npm tokens
- sanitizeText preserves normal conversation text
- sanitizeText handles text with no sensitive data (no-op)

### Parser tests:
- parseSession extracts user and assistant messages
- parseSession skips toolResult lines
- parseSession handles array content format
- parseSession handles string content format
- parseSession detects channel from metadata
- parseSession calculates duration
- sessionToTranscript formats correctly
- generateSessionSummary creates reasonable summary
- generateSessionLabel creates channel+date label

### Import engine tests:
- importOpenClaw with --dry-run makes no changes
- importOpenClaw creates episodes for valid sessions
- importOpenClaw skips sessions with < 3 messages
- importOpenClaw respects --channel filter
- importOpenClaw respects --since filter
- importOpenClaw detects duplicates and skips
- importOpenClaw handles missing openclaw directory gracefully

### Security tests:
- Import NEVER stores raw API keys
- Import NEVER stores OAT tokens
- Imported episodes don't contain metadata blocks
- Sanitization runs on EVERY imported message

---

## Part 6: Things NOT to Change

- **Search algorithm** — unchanged
- **Embedder** — unchanged (episodes get embedded via saveEpisode which already works)
- **Existing CLI commands** — unchanged
- **Config** — no new config needed
- **Schema** — only add source_session_id column to episodes

---

## File Change Summary

| File | Change Type | Scope |
|------|------------|-------|
| `src/import/openclaw.ts` | **NEW** | Session parser + sanitizer |
| `src/import/engine.ts` | **NEW** | Import orchestration |
| `src/cli/import.ts` | **NEW** | CLI command |
| `src/cli/index.ts` | MODIFY | Register import command |
| `src/storage/schema.ts` | MODIFY | Add source_session_id to Episode |
| `src/storage/db.ts` | MODIFY | Migration for source_session_id column |
| `src/core/episodes.ts` | MODIFY | Check for duplicate source_session_id |
| `tests/import.test.ts` | **NEW** | Import + sanitization + security tests |

---

## Security Checklist for Robin

- [ ] sanitizeText MUST strip all OpenClaw metadata blocks
- [ ] sanitizeText MUST redact sk-* API keys
- [ ] sanitizeText MUST redact sk-ant-oat-* tokens
- [ ] sanitizeText MUST redact Bearer tokens
- [ ] sanitizeText MUST redact npm_* tokens
- [ ] toolResult messages are NEVER imported
- [ ] System/custom messages are NEVER imported
- [ ] Only user and assistant text content is imported
- [ ] Confirmation prompt shown unless --yes flag
- [ ] --dry-run makes zero changes to database
- [ ] Security tests specifically verify no credentials leak into episodes

## Build Checklist for Robin

- [ ] Create `src/import/openclaw.ts` — discoverSessions, parseSession, sanitizeText, sessionToTranscript, generateSessionSummary, generateSessionLabel
- [ ] Create `src/import/engine.ts` — importOpenClaw with all options
- [ ] Create `src/cli/import.ts` — CLI command with all flags
- [ ] Update `src/cli/index.ts` — register import command
- [ ] Update `src/storage/schema.ts` — source_session_id on Episode
- [ ] Update `src/storage/db.ts` — migration for new column + index
- [ ] Update `src/core/episodes.ts` — duplicate check on source_session_id
- [ ] Create `tests/import.test.ts` — sanitization + parser + engine + security tests
- [ ] `bun run lint` — must pass
- [ ] `bun test` — all tests pass
- [ ] Manual test with real OpenClaw sessions:
  - [ ] `lucid import openclaw --dry-run`
  - [ ] `lucid import openclaw --channel tamapal --yes`
  - [ ] `lucid session search "TamaPal"`
  - [ ] `lucid session list`
  - [ ] Verify no API keys or tokens in imported episodes
- [ ] Commit: "Import: bulk import OpenClaw sessions with security sanitization"
- [ ] Push to origin main
