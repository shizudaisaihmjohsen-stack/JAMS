CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_no TEXT,
  committee_type TEXT NOT NULL CHECK (committee_type IN ('委員長', 'RC', 'SV', 'JC')),
  name TEXT NOT NULL,
  kana TEXT,
  student_id TEXT NOT NULL UNIQUE,
  email TEXT UNIQUE,
  grade TEXT,
  faculty TEXT,
  department TEXT,
  position TEXT,
  team TEXT,
  meeting_welcome TEXT,
  meeting_1 TEXT,
  meeting_2 TEXT,
  meeting_3 TEXT,
  meeting_4 TEXT,
  meeting_5 TEXT,
  discord_user_id TEXT UNIQUE,
  discord_username TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_discord_user_id ON members(discord_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_member_no
  ON members(member_no)
  WHERE member_no IS NOT NULL AND trim(member_no) <> '';

CREATE TABLE IF NOT EXISTS email_verification_challenges (
  challenge_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  discord_username TEXT,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE(email, discord_user_id)
);

CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_discord_user_id
  ON email_verification_challenges(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_challenges_expires_at
  ON email_verification_challenges(expires_at);

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

CREATE TABLE IF NOT EXISTS oauth_login_states (
  state_hash TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oauth_login_states_expires_at
  ON oauth_login_states(expires_at);

CREATE TABLE IF NOT EXISTS discord_dm_inbox (
  message_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_username TEXT,
  member_no TEXT,
  member_name TEXT,
  content TEXT NOT NULL,
  attachments_json TEXT,
  received_at TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'incoming'
    CHECK (direction IN ('incoming', 'outgoing')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_received_at
  ON discord_dm_inbox(received_at);
CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_author_id
  ON discord_dm_inbox(author_id);
CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_direction
  ON discord_dm_inbox(direction);
