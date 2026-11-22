-- LOCAL DESIGN ONLY. Do not apply remotely without a supervised migration and reconciliation plan.
PRAGMA foreign_keys = ON;

-- Receipt rows deliberately contain the submitted digest and signing metadata only.
-- No submitted content or API credential plaintext is stored.
CREATE TABLE receipt_hashes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hash TEXT NOT NULL CHECK (length(hash) = 64),
  key_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  purge_after INTEGER NOT NULL
);
CREATE INDEX receipt_hashes_purge_idx ON receipt_hashes(purge_after);

-- A failed subscription payment keeps access for seven days before scheduled revocation.
ALTER TABLE accounts ADD COLUMN grace_until INTEGER;
