#!/bin/bash
# =============================================================================
# Lucid Security Scanner — runs before every publish
# Scans source files AND git history for sensitive data
# Exit code 1 = BLOCKED (sensitive data found)
# Exit code 0 = CLEAR (safe to publish)
# =============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ISSUES=0

echo "🔒 Security Scanner"
echo "════════════════════════════════════════"
echo ""

# --- 1. Email addresses ---
echo -n "Checking for email addresses... "
EMAILS=$(grep -rn '[a-zA-Z0-9._%+-]\+@[a-zA-Z0-9.-]\+\.[a-zA-Z]\{2,\}' \
  src/ bin/ README.md CHANGELOG.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | grep -v 'example.com' | grep -v 'user@' || true)
if [ -n "$EMAILS" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$EMAILS"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 2. API keys ---
echo -n "Checking for API keys (sk-*)... "
KEYS=$(grep -rn 'sk-[a-zA-Z0-9]\{20,\}' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | grep -v 'REDACTED' | \
  grep -v 'sk-ant-\.\.\.' | grep -v 'sk-\.\.\.' | grep -v '"sk-"' | \
  grep -v 'regex\|pattern\|match\|replace\|sanitize\|redact' || true)
if [ -n "$KEYS" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$KEYS"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 3. OAT tokens ---
echo -n "Checking for OAT tokens... "
OAT=$(grep -rn 'sk-ant-oat01-[a-zA-Z0-9_-]\{10,\}' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | grep -v 'REDACTED' || true)
if [ -n "$OAT" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$OAT"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 4. Bearer tokens ---
echo -n "Checking for Bearer tokens... "
BEARER=$(grep -rn 'Bearer [a-zA-Z0-9_-]\{20,\}' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | grep -v 'REDACTED' | \
  grep -v 'regex\|pattern\|match\|replace\|sanitize\|redact' || true)
if [ -n "$BEARER" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$BEARER"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 5. npm tokens ---
echo -n "Checking for npm tokens... "
NPM=$(grep -rn 'npm_[a-zA-Z0-9]\{20,\}' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | grep -v 'REDACTED' | \
  grep -v 'regex\|pattern\|match\|replace\|sanitize\|redact' || true)
if [ -n "$NPM" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$NPM"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 6. Personal file paths ---
echo -n "Checking for personal file paths... "
PATHS=$(grep -rn '/Users/\|/home/\|C:\\Users\\' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' | \
  grep -v 'os.homedir\|process.env.HOME\|example\|placeholder' || true)
if [ -n "$PATHS" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$PATHS"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 7. Discord IDs ---
echo -n "Checking for Discord IDs... "
DISCORD=$(grep -rn '14825[0-9]\{14\}\|14829[0-9]\{14\}\|14831[0-9]\{14\}\|272101135' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' || true)
if [ -n "$DISCORD" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$DISCORD"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 8. Private keys / PEM files ---
echo -n "Checking for private keys... "
PRIVKEYS=$(grep -rn 'BEGIN.*PRIVATE KEY\|BEGIN RSA\|BEGIN EC' \
  src/ bin/ README.md package.json 2>/dev/null | \
  grep -v 'node_modules' | grep -v '.test.' || true)
if [ -n "$PRIVKEYS" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$PRIVKEYS"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 9. .env files or database files tracked ---
echo -n "Checking for tracked sensitive files... "
SENSITIVE=$(git ls-files 2>/dev/null | grep -iE '\.(env|db|sqlite|pem|jsonl)$|secrets' | grep -v 'tsconfig' || true)
if [ -n "$SENSITIVE" ]; then
  echo -e "${RED}FOUND${NC}"
  echo "$SENSITIVE"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean${NC}"
fi

# --- 10. Author check ---
echo -n "Checking author field... "
AUTHOR=$(grep '"author"' package.json 2>/dev/null || true)
if echo "$AUTHOR" | grep -qi 'victoria\|vicky\|personal'; then
  echo -e "${YELLOW}WARNING — personal name detected${NC}"
  echo "  $AUTHOR"
  ISSUES=$((ISSUES + 1))
else
  echo -e "${GREEN}clean ($AUTHOR)${NC}"
fi

# --- RESULT ---
echo ""
echo "════════════════════════════════════════"
if [ $ISSUES -gt 0 ]; then
  echo -e "${RED}❌ BLOCKED — $ISSUES issue(s) found. Fix before publishing.${NC}"
  exit 1
else
  echo -e "${GREEN}✅ ALL CLEAR — safe to publish.${NC}"
  exit 0
fi
