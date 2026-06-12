CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_no TEXT,
  committee_type TEXT NOT NULL CHECK (committee_type IN ('RC', 'SV', 'JC')),
  name TEXT NOT NULL,
  kana TEXT,
  line_name TEXT,
  student_id TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
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
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_discord_user_id ON members(discord_user_id);

CREATE TABLE IF NOT EXISTS email_verification_codes (
  email TEXT PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  token_hash TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_discord_user_id
  ON email_verification_codes(discord_user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_codes_token_hash
  ON email_verification_codes(token_hash);
