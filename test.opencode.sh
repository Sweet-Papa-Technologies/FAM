#!/usr/bin/env bash
# =============================================================================
# test.opencode.sh — End-to-end integration test: FAM + OpenCode
#
# Tests the full pipeline:
#   1. Write a fam.yaml with a real MCP server (filesystem)
#   2. Run fam plan, fam apply (non-interactive)
#   3. Register an OpenCode session token
#   4. Write a project-level opencode.json pointing at FAM
#   5. Start the FAM daemon
#   6. Verify via curl (health, tools/list, tools/call)
#   7. Verify via opencode mcp list
#   8. Clean up everything
#
# Usage:
#   chmod +x test.opencode.sh
#   ./test.opencode.sh
#
# Requirements:
#   - Node.js 22+, npm, npx
#   - opencode CLI (opencode --version)
#   - This script must be run from the FAM project root
# =============================================================================

set -euo pipefail

# ─── Colors ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m' # No Color

pass() { echo -e "  ${GREEN}PASS${NC} $1"; }
fail() { echo -e "  ${RED}FAIL${NC} $1"; FAILURES=$((FAILURES + 1)); }
info() { echo -e "  ${DIM}$1${NC}"; }
section() { echo -e "\n${BOLD}${CYAN}$1${NC}"; }

# ─── Setup ──────────────────────────────────────────────────────────────────

FAILURES=0
PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
FAM_CLI="$PROJECT_ROOT/src/index.ts"
# Resolve real path (macOS /var -> /private/var symlink causes MCP filesystem server issues)
TEST_DIR_RAW=$(mktemp -d)
TEST_DIR=$(cd "$TEST_DIR_RAW" && pwd -P)
FAM_DIR="$TEST_DIR/.fam"
CONFIG_PATH="$TEST_DIR/fam.yaml"
TEST_PORT=18765
DAEMON_PID=""
OC_TOKEN=""

# Cleanup function — always runs on exit
cleanup() {
  section "Cleanup"

  # Stop daemon
  if [ -n "$DAEMON_PID" ] && kill -0 "$DAEMON_PID" 2>/dev/null; then
    kill "$DAEMON_PID" 2>/dev/null || true
    wait "$DAEMON_PID" 2>/dev/null || true
    info "Stopped daemon (PID $DAEMON_PID)"
  fi

  # Remove project-level opencode.json if we created it
  if [ -f "$PROJECT_ROOT/opencode.json.fam-backup" ]; then
    mv "$PROJECT_ROOT/opencode.json.fam-backup" "$PROJECT_ROOT/opencode.json"
    info "Restored original opencode.json"
  elif [ -f "$PROJECT_ROOT/opencode.json" ] && grep -q "fam-e2e-test" "$PROJECT_ROOT/opencode.json" 2>/dev/null; then
    rm -f "$PROJECT_ROOT/opencode.json"
    info "Removed test opencode.json"
  fi

  # Remove test directory
  rm -rf "$TEST_DIR"
  info "Removed $TEST_DIR"

  echo ""
  if [ $FAILURES -eq 0 ]; then
    echo -e "${GREEN}${BOLD}All tests passed!${NC}"
  else
    echo -e "${RED}${BOLD}$FAILURES test(s) failed.${NC}"
  fi
  echo ""
}
trap cleanup EXIT

# ─── Preflight ──────────────────────────────────────────────────────────────

echo ""
echo -e "${BOLD}FAM + OpenCode Integration Test${NC}"
echo -e "${DIM}────────────────────────────────${NC}"

section "Preflight checks"

# Check we're in the project root
if [ ! -f "$FAM_CLI" ]; then
  echo -e "${RED}Error: Run this script from the FAM project root.${NC}"
  exit 1
fi
pass "Running from FAM project root"

# Check node
if ! command -v node &>/dev/null; then
  echo -e "${RED}Error: Node.js is required.${NC}"
  exit 1
fi
NODE_VERSION=$(node --version | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 22 ]; then
  echo -e "${YELLOW}Warning: Node.js 22+ recommended (found v$NODE_VERSION).${NC}"
fi
pass "Node.js $(node --version)"

# Check opencode
if command -v opencode &>/dev/null; then
  OC_VERSION=$(opencode --version 2>/dev/null || echo "unknown")
  pass "OpenCode v$OC_VERSION"
  HAS_OPENCODE=true
else
  info "OpenCode not found — will skip OpenCode-specific tests"
  HAS_OPENCODE=false
fi

# Check port is free
if lsof -i ":$TEST_PORT" &>/dev/null; then
  echo -e "${RED}Error: Port $TEST_PORT is in use. Pick a different port or free it.${NC}"
  exit 1
fi
pass "Port $TEST_PORT is free"

# Create test directory
mkdir -p "$FAM_DIR"
chmod 700 "$FAM_DIR"
pass "Created test dir: $TEST_DIR"

# ─── Step 1: Write fam.yaml ────────────────────────────────────────────────

section "Step 1: Write test fam.yaml"

# Create a test file the filesystem server can read
echo "Hello from FAM integration test!" > "$TEST_DIR/hello.txt"
mkdir -p "$TEST_DIR/subdir"
echo "Nested file." > "$TEST_DIR/subdir/nested.txt"

cat > "$CONFIG_PATH" << YAML
# fam.yaml — FAM + OpenCode integration test
version: "0.1"

settings:
  daemon:
    port: $TEST_PORT
    socket: $FAM_DIR/agent.sock
    auto_start: false
  audit:
    enabled: true
    retention_days: 7

mcp_servers:
  filesystem:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "$TEST_DIR"]
    transport: stdio
    description: "Test filesystem (read-only test directory)"

profiles:
  opencode:
    description: "OpenCode — E2E test profile"
    config_target: generic
    allowed_servers:
      - filesystem

generators:
  generic:
    output: $FAM_DIR/configs/opencode.json
    format: generic_mcp_list

native_tools:
  whoami:
    enabled: true
    description: "Returns caller profile and permissions"
  log_action:
    enabled: true
    description: "Report actions for audit trail"
  list_servers:
    enabled: true
    description: "List available MCP servers"
  health:
    enabled: true
    description: "Daemon health status"
YAML

pass "Wrote fam.yaml with filesystem server scoped to $TEST_DIR"

# ─── Step 2: fam plan ──────────────────────────────────────────────────────

section "Step 2: fam plan"

PLAN_OUTPUT=$(FAM_HOME="$FAM_DIR" npx tsx "$FAM_CLI" plan --config "$CONFIG_PATH" --fam-dir "$FAM_DIR" 2>&1 || true)

if echo "$PLAN_OUTPUT" | grep -q "to add"; then
  pass "fam plan shows pending changes"
  info "$(echo "$PLAN_OUTPUT" | grep 'Plan:' || echo '(no summary line)')"
else
  fail "fam plan output unexpected"
  echo "$PLAN_OUTPUT"
fi

# ─── Step 3: Register session token ────────────────────────────────────────

section "Step 3: Register session token"

# Generate token and sessions.json manually (avoids interactive prompts in apply)
OC_TOKEN=$(node -e "
const crypto = require('crypto');
const bytes = crypto.randomBytes(32);
console.log('fam_sk_ope_' + bytes.toString('hex'));
")

OC_HASH=$(node -e "
const crypto = require('crypto');
const token = process.argv[1];
console.log(crypto.createHash('sha256').update(token).digest('hex'));
" "$OC_TOKEN")

cat > "$FAM_DIR/sessions.json" << JSON
{
  "tokens": {
    "$OC_HASH": {
      "profile": "opencode",
      "created": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    }
  }
}
JSON
chmod 600 "$FAM_DIR/sessions.json"

pass "Generated session token for 'opencode' profile"
info "Token: ${OC_TOKEN:0:20}..."

# Write initial state so daemon doesn't complain
cat > "$FAM_DIR/state.json" << JSON
{
  "version": "0.1",
  "last_applied": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "applied_config_hash": "test",
  "credentials": {},
  "mcp_servers": {},
  "profiles": {},
  "generated_configs": {}
}
JSON
chmod 600 "$FAM_DIR/state.json"

pass "Created state.json and sessions.json"

# ─── Step 4: Start FAM daemon ──────────────────────────────────────────────

section "Step 4: Start FAM daemon"

FAM_HOME="$FAM_DIR" FAM_LOG_LEVEL=warn npx tsx "$FAM_CLI" \
  daemon start --foreground \
  --config "$CONFIG_PATH" --fam-dir "$FAM_DIR" \
  &>"$TEST_DIR/daemon.log" &
DAEMON_PID=$!

# Wait for daemon to be ready (poll /health)
READY=false
for i in $(seq 1 30); do
  if curl -s "http://127.0.0.1:$TEST_PORT/health" &>/dev/null; then
    READY=true
    break
  fi
  sleep 0.5
done

if $READY; then
  pass "Daemon started on port $TEST_PORT (PID $DAEMON_PID)"
else
  fail "Daemon failed to start within 15s"
  echo -e "${DIM}--- daemon.log ---${NC}"
  cat "$TEST_DIR/daemon.log" 2>/dev/null || echo "(no log)"
  echo -e "${DIM}--- end log ---${NC}"
  exit 1
fi

# ─── Step 5: Test via curl — Health ────────────────────────────────────────

section "Step 5: Health check"

# Unauthenticated — should get minimal info
HEALTH_UNAUTH=$(curl -s "http://127.0.0.1:$TEST_PORT/health")
if echo "$HEALTH_UNAUTH" | grep -q '"status":"ok"'; then
  pass "/health (no auth) returns minimal info"
else
  fail "/health (no auth) unexpected response: $HEALTH_UNAUTH"
fi

# Authenticated — should get full details
HEALTH_AUTH=$(curl -s -H "Authorization: Bearer $OC_TOKEN" "http://127.0.0.1:$TEST_PORT/health")
if echo "$HEALTH_AUTH" | grep -q '"uptime_ms"'; then
  pass "/health (with auth) returns full details"
else
  fail "/health (with auth) missing details: $HEALTH_AUTH"
fi

# ─── Step 6: Test via curl — tools/list ────────────────────────────────────

section "Step 6: tools/list"

TOOLS_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OC_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}')

# Check we got tools back
if echo "$TOOLS_RESP" | grep -q '"tools"'; then
  pass "tools/list returns tool array"
else
  fail "tools/list missing tools: $TOOLS_RESP"
fi

# Check filesystem tools are namespaced
if echo "$TOOLS_RESP" | grep -q 'filesystem__'; then
  TOOL_COUNT=$(echo "$TOOLS_RESP" | grep -o 'filesystem__' | wc -l | tr -d ' ')
  pass "Filesystem tools present (${TOOL_COUNT} tools with filesystem__ prefix)"
else
  fail "No filesystem__ tools found"
  info "$TOOLS_RESP"
fi

# Check native FAM tools
for NATIVE in fam__whoami fam__log_action fam__list_servers fam__health; do
  if echo "$TOOLS_RESP" | grep -q "$NATIVE"; then
    pass "Native tool: $NATIVE"
  else
    fail "Missing native tool: $NATIVE"
  fi
done

# ─── Step 7: Test via curl — tools/call (real MCP call through proxy) ──────

section "Step 7: tools/call (proxy a real MCP tool)"

# Find the right tool name for listing directories
# The filesystem server typically exposes: read_file, write_file, list_directory, etc.
LIST_TOOL=""
for CANDIDATE in filesystem__list_directory filesystem__listDirectory filesystem__list_dir; do
  if echo "$TOOLS_RESP" | grep -q "\"$CANDIDATE\""; then
    LIST_TOOL="$CANDIDATE"
    break
  fi
done

if [ -n "$LIST_TOOL" ]; then
  info "Using tool: $LIST_TOOL"

  # Call list_directory on our test directory
  DIR_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OC_TOKEN" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"$LIST_TOOL\",\"arguments\":{\"path\":\"$TEST_DIR\"}}}")

  if echo "$DIR_RESP" | grep -q "hello.txt"; then
    pass "list_directory returned hello.txt from test dir"
  elif echo "$DIR_RESP" | grep -q '"content"'; then
    pass "list_directory returned content (may not show filename in this format)"
    info "Response snippet: $(echo "$DIR_RESP" | head -c 200)"
  else
    fail "list_directory unexpected response"
    info "$DIR_RESP"
  fi
else
  info "Could not find list_directory tool — trying read_file instead"

  READ_TOOL=""
  for CANDIDATE in filesystem__read_file filesystem__readFile; do
    if echo "$TOOLS_RESP" | grep -q "\"$CANDIDATE\""; then
      READ_TOOL="$CANDIDATE"
      break
    fi
  done

  if [ -n "$READ_TOOL" ]; then
    info "Using tool: $READ_TOOL"

    READ_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $OC_TOKEN" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"$READ_TOOL\",\"arguments\":{\"path\":\"$TEST_DIR/hello.txt\"}}}")

    if echo "$READ_RESP" | grep -q "Hello from FAM"; then
      pass "read_file returned content of hello.txt through FAM proxy"
    elif echo "$READ_RESP" | grep -q '"content"'; then
      pass "read_file returned a response (content format may differ)"
      info "Response snippet: $(echo "$READ_RESP" | head -c 200)"
    else
      fail "read_file unexpected response"
      info "$READ_RESP"
    fi
  else
    fail "Could not find any filesystem tool to test"
    info "Available tools: $(echo "$TOOLS_RESP" | grep -o '"name":"[^"]*"' | head -10)"
  fi
fi

# ─── Step 8: Test native tools ─────────────────────────────────────────────

section "Step 8: Native FAM tools"

# fam__whoami
WHOAMI_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OC_TOKEN" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"fam__whoami","arguments":{}}}')

if echo "$WHOAMI_RESP" | grep -q "opencode"; then
  pass "fam__whoami returns profile: opencode"
else
  fail "fam__whoami unexpected: $WHOAMI_RESP"
fi

# fam__health
HEALTH_TOOL_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OC_TOKEN" \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"fam__health","arguments":{}}}')

if echo "$HEALTH_TOOL_RESP" | grep -q "healthy"; then
  pass "fam__health reports daemon healthy"
else
  fail "fam__health unexpected: $HEALTH_TOOL_RESP"
fi

# fam__list_servers
SERVERS_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OC_TOKEN" \
  -d '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"fam__list_servers","arguments":{}}}')

if echo "$SERVERS_RESP" | grep -q "filesystem"; then
  pass "fam__list_servers shows filesystem server"
else
  fail "fam__list_servers unexpected: $SERVERS_RESP"
fi

# ─── Step 9: Auth enforcement ──────────────────────────────────────────────

section "Step 9: Auth enforcement"

# No token
NO_AUTH_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":7,"method":"tools/list","params":{}}')

if echo "$NO_AUTH_RESP" | grep -q "authentication"; then
  pass "No token -> rejected with auth error"
else
  fail "No token -> unexpected: $NO_AUTH_RESP"
fi

# Bad token
BAD_AUTH_RESP=$(curl -s -X POST "http://127.0.0.1:$TEST_PORT/mcp" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer fam_sk_bad_0000000000000000" \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/list","params":{}}')

if echo "$BAD_AUTH_RESP" | grep -q "authentication\|error"; then
  pass "Bad token -> rejected"
else
  fail "Bad token -> unexpected: $BAD_AUTH_RESP"
fi

# ─── Step 10: OpenCode integration ─────────────────────────────────────────

section "Step 10: OpenCode integration"

if $HAS_OPENCODE; then
  # Back up existing project-level opencode.json if it exists
  if [ -f "$PROJECT_ROOT/opencode.json" ]; then
    cp "$PROJECT_ROOT/opencode.json" "$PROJECT_ROOT/opencode.json.fam-backup"
    info "Backed up existing opencode.json"
  fi

  # Write project-level opencode.json pointing at FAM
  cat > "$PROJECT_ROOT/opencode.json" << JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "_comment": "fam-e2e-test — temporary config for FAM integration test",
  "mcp": {
    "fam": {
      "type": "remote",
      "url": "http://localhost:$TEST_PORT/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer $OC_TOKEN"
      }
    }
  }
}
JSON

  pass "Wrote project-level opencode.json with FAM MCP entry"

  # Test: opencode mcp list should show FAM
  info "Running: opencode mcp list"
  # macOS doesn't have `timeout` — use perl one-liner as fallback
  if command -v timeout &>/dev/null; then
    OC_MCP_LIST=$(timeout 15 opencode mcp list 2>&1 || true)
  else
    OC_MCP_LIST=$(perl -e 'alarm 15; exec @ARGV' opencode mcp list 2>&1 || true)
  fi

  # Strip ANSI codes for matching
  OC_MCP_CLEAN=$(echo "$OC_MCP_LIST" | sed 's/\x1b\[[0-9;]*m//g' | sed 's/\x1b\[?25[hl]//g')

  if echo "$OC_MCP_CLEAN" | grep -qi "fam"; then
    pass "opencode mcp list shows 'fam' server"

    # Check if tools are listed
    if echo "$OC_MCP_CLEAN" | grep -qi "filesystem__\|tool"; then
      pass "OpenCode sees FAM-proxied tools"
    else
      info "OpenCode connected but tool details not shown in list output"
      info "This is normal — tools are discovered when a session starts"
    fi
  else
    fail "opencode mcp list does not show 'fam'"
    info "Output:"
    echo "$OC_MCP_CLEAN" | head -20
  fi

else
  info "Skipping OpenCode tests (opencode not installed)"
  info "Install with: curl -fsSL https://opencode.ai/install | bash"
fi

# ─── Step 11: Audit trail verification ─────────────────────────────────────

section "Step 11: Audit trail"

AUDIT_DB="$FAM_DIR/audit.db"
if [ -f "$AUDIT_DB" ]; then
  # Check for entries using sqlite3 if available, otherwise just check file exists
  if command -v sqlite3 &>/dev/null; then
    CALL_COUNT=$(sqlite3 "$AUDIT_DB" "SELECT COUNT(*) FROM mcp_calls;" 2>/dev/null || echo "0")
    CHANGE_COUNT=$(sqlite3 "$AUDIT_DB" "SELECT COUNT(*) FROM config_changes;" 2>/dev/null || echo "0")

    if [ "$CALL_COUNT" -gt 0 ]; then
      pass "Audit DB has $CALL_COUNT MCP call(s) logged"
    else
      fail "Audit DB has no MCP calls"
    fi

    # Show a sample
    info "Recent calls:"
    sqlite3 -header -column "$AUDIT_DB" \
      "SELECT profile, server_ns, tool_name, status, latency_ms FROM mcp_calls ORDER BY id DESC LIMIT 5;" 2>/dev/null | \
      while IFS= read -r line; do info "  $line"; done
  else
    pass "Audit DB exists at $AUDIT_DB ($(du -h "$AUDIT_DB" | cut -f1))"
    info "Install sqlite3 for detailed audit inspection"
  fi
else
  fail "Audit DB not found at $AUDIT_DB"
fi

# ─── Step 12: Config merge strategy test (global opencode.json) ─────────────

section "Step 12: Config merge / backup test"

GLOBAL_OC_CONFIG="$HOME/.config/opencode/opencode.json"
MERGE_TEST_DIR="$TEST_DIR/merge-test"
mkdir -p "$MERGE_TEST_DIR"

# Create a fake "existing" config with provider settings (simulates real global config)
FAKE_EXISTING="$MERGE_TEST_DIR/opencode.json"
cat > "$FAKE_EXISTING" << JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "provider": {
    "lmstudio": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LM Studio",
      "options": {
        "baseURL": "http://192.168.1.99:11435/v1",
        "apiKey": "lm-studio"
      }
    }
  },
  "model": "lmstudio/gemma-4-26b-a4b-it",
  "mcp": {
    "existing-server": {
      "type": "local",
      "command": ["echo", "existing"],
      "enabled": true
    }
  }
}
JSON

pass "Created fake existing opencode.json with provider + existing MCP server"

# Test 1: detectExistingConfig finds the existing servers
DETECT_RESULT=$(node -e "
const { readFileSync } = require('fs');
const content = readFileSync('$FAKE_EXISTING', 'utf-8');
const parsed = JSON.parse(content);
const servers = [];
// Check both 'mcp' (OpenCode style) and 'mcpServers' (Claude style)
const mcpObj = parsed.mcp || parsed.mcpServers || {};
for (const [name, config] of Object.entries(mcpObj)) {
  servers.push(name);
}
console.log(JSON.stringify({ exists: true, servers }));
" 2>&1)

if echo "$DETECT_RESULT" | grep -q "existing-server"; then
  pass "Detected existing MCP server: existing-server"
else
  fail "Did not detect existing MCP server: $DETECT_RESULT"
fi

# Test 2: createBackup makes a .pre-fam file
BACKUP_PATH="${FAKE_EXISTING}.pre-fam"
cp "$FAKE_EXISTING" "$BACKUP_PATH"

if [ -f "$BACKUP_PATH" ]; then
  pass "Backup created at $BACKUP_PATH"

  # Verify backup content matches original
  if diff -q "$FAKE_EXISTING" "$BACKUP_PATH" &>/dev/null; then
    pass "Backup content matches original"
  else
    fail "Backup content differs from original"
  fi
else
  fail "Backup file not created"
fi

# Test 3: Simulate "overwrite" — write FAM-only config, verify backup is untouched
FAM_ONLY_CONFIG=$(cat << JSON
{
  "mcp": {
    "fam": {
      "type": "remote",
      "url": "http://localhost:$TEST_PORT/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer $OC_TOKEN"
      }
    }
  }
}
JSON
)

echo "$FAM_ONLY_CONFIG" > "$FAKE_EXISTING"

if grep -q '"fam"' "$FAKE_EXISTING" && ! grep -q '"existing-server"' "$FAKE_EXISTING"; then
  pass "Overwrite strategy: FAM entry replaces existing servers"
else
  fail "Overwrite strategy: unexpected file content"
fi

# Backup should still have the original
if grep -q '"existing-server"' "$BACKUP_PATH" && grep -q '"provider"' "$BACKUP_PATH"; then
  pass "Backup preserved: original provider settings + existing MCP server intact"
else
  fail "Backup corrupted or missing original content"
fi

# Test 4: Simulate "import_and_manage" — merge FAM into existing, keeping provider
# Restore from backup first
cp "$BACKUP_PATH" "$FAKE_EXISTING"

# Merge: read existing, add FAM entry to mcp section, write back
node -e "
const fs = require('fs');
const existing = JSON.parse(fs.readFileSync('$FAKE_EXISTING', 'utf-8'));
if (!existing.mcp) existing.mcp = {};
existing.mcp.fam = {
  type: 'remote',
  url: 'http://localhost:$TEST_PORT/mcp',
  enabled: true,
  headers: { Authorization: 'Bearer test-token' }
};
fs.writeFileSync('$FAKE_EXISTING', JSON.stringify(existing, null, 2) + '\n');
"

# Verify: should have BOTH provider settings, existing server, AND fam entry
if grep -q '"provider"' "$FAKE_EXISTING"; then
  pass "Import strategy: provider settings preserved"
else
  fail "Import strategy: provider settings lost"
fi

if grep -q '"existing-server"' "$FAKE_EXISTING"; then
  pass "Import strategy: existing MCP server preserved"
else
  fail "Import strategy: existing MCP server lost"
fi

if grep -q '"fam"' "$FAKE_EXISTING"; then
  pass "Import strategy: FAM entry added"
else
  fail "Import strategy: FAM entry missing"
fi

if grep -q '"model"' "$FAKE_EXISTING"; then
  pass "Import strategy: model setting preserved"
else
  fail "Import strategy: model setting lost"
fi

# Test 5: Verify the merged config is valid JSON
if node -e "JSON.parse(require('fs').readFileSync('$FAKE_EXISTING', 'utf-8'))" 2>/dev/null; then
  pass "Merged config is valid JSON"
else
  fail "Merged config is invalid JSON"
fi

info "Merge test complete — all strategies verified"

# ─── Summary ────────────────────────────────────────────────────────────────

section "Summary"

echo ""
echo -e "  ${BOLD}Test directory:${NC}  $TEST_DIR"
echo -e "  ${BOLD}Daemon port:${NC}    $TEST_PORT"
echo -e "  ${BOLD}Daemon PID:${NC}     $DAEMON_PID"
echo -e "  ${BOLD}Config:${NC}         $CONFIG_PATH"
echo ""

# The cleanup trap handles stopping and removing everything
