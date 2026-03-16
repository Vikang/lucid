#!/bin/bash
# =============================================================================
# Lucid Agent Hooks Installer
# Adds memory lookup instructions to any AGENTS.md / CLAUDE.md file
# 
# Usage:
#   lucid-install-hooks                    # Auto-detect OpenClaw workspaces
#   lucid-install-hooks /path/to/AGENTS.md # Specific file
#   lucid-install-hooks --all              # All OpenClaw agent workspaces
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

HOOK_MARKER="## ⚠️ MANDATORY FIRST STEP — Memory Lookup"

HOOK_CONTENT='## ⚠️ MANDATORY FIRST STEP — Memory Lookup (DO THIS BEFORE ANYTHING ELSE)

Before responding to ANY question about past work, decisions, projects, preferences, or history:

1. **Run `lucid recall "relevant query"`** — searches the shared memory database (local, instant)
2. **Run `lucid session search "query"`** if asking about a specific conversation
3. **If Lucid returns results** → ground your answer in them, cite what you found
4. **If Lucid returns nothing** → say "I don'"'"'t have a memory of this" instead of guessing

After EVERY meaningful session:
- **Save key facts:** `lucid add "fact" --tags tag1,tag2 -i 0.9 --type TYPE --triggers "search phrases"`
- **Save the session:** `lucid session save --text "summary" --label "name" --tags topics`

This is NON-OPTIONAL. The memory database is shared across ALL sessions and agents.

---
'

install_hook() {
  local file="$1"
  local name=$(basename $(dirname "$file"))
  
  # Check if already installed
  if grep -q "MANDATORY FIRST STEP.*Memory Lookup" "$file" 2>/dev/null; then
    echo -e "  ${YELLOW}⏭ $name — already has Lucid hooks${NC}"
    return
  fi
  
  # Find the first heading (# ...) and insert after it
  local first_line=$(head -1 "$file")
  if [[ "$first_line" == "# "* ]]; then
    # Insert hook block after the first heading line
    local temp=$(mktemp)
    echo "$first_line" > "$temp"
    echo "" >> "$temp"
    echo "$HOOK_CONTENT" >> "$temp"
    tail -n +2 "$file" >> "$temp"
    mv "$temp" "$file"
    echo -e "  ${GREEN}✅ $name — Lucid hooks installed${NC}"
  else
    # No heading found, prepend
    local temp=$(mktemp)
    echo "$HOOK_CONTENT" > "$temp"
    cat "$file" >> "$temp"
    mv "$temp" "$file"
    echo -e "  ${GREEN}✅ $name — Lucid hooks installed (prepended)${NC}"
  fi
}

echo "🧠 Lucid Agent Hooks Installer"
echo "════════════════════════════════════════"
echo ""

if [ -n "$1" ] && [ "$1" != "--all" ]; then
  # Specific file
  if [ -f "$1" ]; then
    install_hook "$1"
  else
    echo -e "${RED}File not found: $1${NC}"
    exit 1
  fi
else
  # Auto-detect OpenClaw workspaces
  OPENCLAW_DIR="${HOME}/.openclaw"
  
  if [ ! -d "$OPENCLAW_DIR" ]; then
    echo -e "${RED}OpenClaw directory not found at $OPENCLAW_DIR${NC}"
    exit 1
  fi
  
  echo "Scanning OpenClaw agent workspaces..."
  echo ""
  
  # Find all AGENTS.md files in workspaces
  found=0
  for workspace in "$OPENCLAW_DIR"/workspace-*/; do
    if [ -f "$workspace/AGENTS.md" ]; then
      install_hook "$workspace/AGENTS.md"
      found=$((found + 1))
    fi
  done
  
  # Also check for CLAUDE.md in project directories
  for agents_file in "$OPENCLAW_DIR"/agents/*/agent/AGENTS.md; do
    if [ -f "$agents_file" ]; then
      install_hook "$agents_file"
      found=$((found + 1))
    fi
  done
  
  echo ""
  if [ $found -eq 0 ]; then
    echo -e "${YELLOW}No AGENTS.md files found in OpenClaw workspaces${NC}"
  else
    echo -e "${GREEN}Done. $found agent(s) updated.${NC}"
  fi
fi

echo ""
echo "Lucid will now be checked first in every session."
echo "Run 'lucid recall \"test\"' to verify it's working."
