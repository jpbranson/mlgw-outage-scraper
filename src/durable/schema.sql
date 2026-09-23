PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA busy_timeout = 5000;

CREATE TABLE IF NOT EXISTS poll_attempts (
  id TEXT PRIMARY KEY,
  scheduled_ms INTEGER NOT NULL,
  received_ms INTEGER NOT NULL,
  http_status INTEGER,
  outcome TEXT NOT NULL,
  error TEXT,
  raw_key TEXT,
  manifest_key TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  parser_hash TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS attempts_received ON poll_attempts(received_ms);

-- Compact, order-independent projection inputs. No historical feature arrays.
CREATE TABLE IF NOT EXISTS attempt_facts (
  id TEXT PRIMARY KEY REFERENCES poll_attempts(id),
  slot_ms INTEGER NOT NULL,
  base_quality TEXT NOT NULL,
  customers INTEGER,
  outages INTEGER,
  html_customers INTEGER,
  raw_hash TEXT,
  parser_version TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  event_keys_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS facts_slot ON attempt_facts(slot_ms);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY REFERENCES poll_attempts(id),
  slot_ms INTEGER NOT NULL UNIQUE,
  captured_ms INTEGER NOT NULL,
  raw_key TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  parser_hash TEXT NOT NULL,
  quality TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  event_keys_json TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS snapshots_time ON snapshots(captured_ms);
CREATE INDEX IF NOT EXISTS snapshots_cached_events ON snapshots(captured_ms) WHERE event_keys_json<>'null';
CREATE INDEX IF NOT EXISTS facts_cached_events ON attempt_facts(slot_ms) WHERE event_keys_json<>'null';
CREATE TABLE IF NOT EXISTS totals (
  snapshot_id TEXT PRIMARY KEY REFERENCES snapshots(id),
  customers INTEGER NOT NULL CHECK(customers >= 0),
  outages INTEGER NOT NULL CHECK(outages >= 0)
) STRICT;

CREATE TABLE IF NOT EXISTS collector_state (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_ms INTEGER NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS maintenance_queue (day TEXT PRIMARY KEY) STRICT;
CREATE TABLE IF NOT EXISTS rollups (
  resolution TEXT NOT NULL,
  bucket_ms INTEGER NOT NULL,
  customer_minutes REAL NOT NULL,
  covered_minutes REAL NOT NULL,
  mean_customers REAL,
  peak_customers INTEGER,
  peak_outages INTEGER,
  observations INTEGER NOT NULL,
  PRIMARY KEY(resolution, bucket_ms)
) STRICT;
PRAGMA user_version = 2;
