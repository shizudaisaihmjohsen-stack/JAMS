CREATE TABLE email_verification_challenges (
  challenge_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  code_hash TEXT NOT NULL,
  token_hash TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(email, discord_user_id)
);

INSERT OR REPLACE INTO email_verification_challenges (
  challenge_id,
  email,
  discord_user_id,
  discord_username,
  code_hash,
  token_hash,
  expires_at,
  attempts,
  created_at
)
SELECT
  lower(hex(randomblob(16))),
  email,
  discord_user_id,
  discord_username,
  code_hash,
  token_hash,
  expires_at,
  attempts,
  created_at
FROM email_verification_codes;

CREATE INDEX idx_email_verification_challenges_discord_user_id
  ON email_verification_challenges(discord_user_id);
CREATE INDEX idx_email_verification_challenges_token_hash
  ON email_verification_challenges(token_hash);
CREATE INDEX idx_email_verification_challenges_expires_at
  ON email_verification_challenges(expires_at);

CREATE TABLE oauth_login_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_login_states_expires_at
  ON oauth_login_states(expires_at);
