-- FAM Audit Database Schema
-- See DESIGN.md Section 5.4

-- MCP call log: every proxied tool call
CREATE TABLE IF NOT EXISTS mcp_calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  profile     TEXT NOT NULL,
  server_ns   TEXT NOT NULL,
  tool_name   TEXT NOT NULL,
  status      TEXT NOT NULL,
  latency_ms  INTEGER,
  error_msg   TEXT
);

-- Config change log: every apply, secret set, register, etc.
CREATE TABLE IF NOT EXISTS config_changes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
  action      TEXT NOT NULL,
  target      TEXT NOT NULL,
  details     TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_timestamp ON mcp_calls(timestamp);
CREATE INDEX IF NOT EXISTS idx_calls_profile   ON mcp_calls(profile);
CREATE INDEX IF NOT EXISTS idx_calls_server    ON mcp_calls(server_ns);
CREATE INDEX IF NOT EXISTS idx_changes_ts      ON config_changes(timestamp);
CREATE INDEX IF NOT EXISTS idx_changes_action  ON config_changes(action);
