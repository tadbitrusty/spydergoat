-- Immutable production migration for the Pro-first billing authority.
-- Fail closed if the inventoried-empty legacy users table has gained any row.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY
);
CREATE TABLE _migration_guard_empty_legacy_users (
  row_count INTEGER NOT NULL CHECK (row_count = 0)
);
INSERT INTO _migration_guard_empty_legacy_users (row_count)
SELECT COUNT(*) FROM users;
DROP TABLE _migration_guard_empty_legacy_users;
DROP INDEX IF EXISTS idx_users_api_key;
DROP TABLE users;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  subscription_status TEXT NOT NULL DEFAULT 'pending',
  current_period_calls INTEGER NOT NULL DEFAULT 0 CHECK (current_period_calls >= 0),
  wallet_balance INTEGER NOT NULL DEFAULT 0 CHECK (wallet_balance >= 0),
  period_start INTEGER,
  period_end INTEGER,
  last_stripe_event_created INTEGER NOT NULL DEFAULT 0 CHECK (last_stripe_event_created >= 0),
  last_stripe_event_id TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE api_credentials (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  checkout_session_id TEXT NOT NULL UNIQUE,
  key_digest TEXT NOT NULL UNIQUE,
  display_suffix TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  revoked_at INTEGER
);
CREATE INDEX api_credentials_account_idx ON api_credentials(account_id);
CREATE UNIQUE INDEX api_credentials_one_active_account_idx
  ON api_credentials(account_id) WHERE revoked_at IS NULL;

CREATE TABLE stripe_events (
  event_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  event_created INTEGER NOT NULL CHECK (event_created > 0),
  checkout_session_id TEXT REFERENCES api_credentials(checkout_session_id),
  delivery_session_id TEXT REFERENCES key_deliveries(checkout_session_id),
  status TEXT NOT NULL CHECK (status IN ('processing', 'processed')),
  created_at INTEGER NOT NULL,
  processed_at INTEGER
);

CREATE TABLE wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_event_id TEXT NOT NULL UNIQUE REFERENCES stripe_events(event_id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  credit_delta INTEGER NOT NULL CHECK (credit_delta > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX wallet_ledger_account_idx ON wallet_ledger(account_id, created_at);

-- No plaintext API key column is permitted in this schema.
CREATE TABLE key_deliveries (
  checkout_session_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  encrypted_key BLOB NOT NULL,
  iv BLOB NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
