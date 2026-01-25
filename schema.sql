-- Spydergoat users table
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  api_key TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT,
  wallet_balance INTEGER DEFAULT 0,  -- stored in microdollars ($0.001 = 1)
  current_period_calls INTEGER DEFAULT 0,
  period_start INTEGER NOT NULL,     -- unix timestamp
  created_at INTEGER NOT NULL        -- unix timestamp
);

-- Index for API key lookups (every request)
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
