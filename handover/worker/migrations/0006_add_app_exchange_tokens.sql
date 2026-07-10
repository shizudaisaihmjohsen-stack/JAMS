CREATE TABLE IF NOT EXISTS app_exchange_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  username TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_app_exchange_tokens_expires_at
  ON app_exchange_tokens(expires_at);
