CREATE TABLE email_verification_codes (
  email TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  code_hash TEXT NOT NULL,
  token_hash TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT INTO email_verification_codes (
  email,
  discord_user_id,
  discord_username,
  code_hash,
  token_hash,
  expires_at,
  attempts,
  created_at
) VALUES (
  'migration-test@example.ac.jp',
  '123456789012345678',
  'migration-test',
  'code-hash',
  'token-hash',
  4102444800000,
  0,
  0
);
