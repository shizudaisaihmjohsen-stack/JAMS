PRAGMA foreign_keys=off;

CREATE TABLE members_new (
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

INSERT INTO members_new (
  id,
  member_no,
  committee_type,
  name,
  kana,
  line_name,
  student_id,
  email,
  grade,
  faculty,
  department,
  position,
  team,
  meeting_welcome,
  meeting_1,
  meeting_2,
  meeting_3,
  meeting_4,
  meeting_5,
  discord_user_id,
  verified_at,
  created_at,
  updated_at
)
SELECT
  id,
  member_no,
  committee_type,
  name,
  kana,
  line_name,
  student_id,
  email,
  grade,
  faculty,
  department,
  position,
  team,
  meeting_welcome,
  meeting_1,
  meeting_2,
  meeting_3,
  meeting_4,
  meeting_5,
  discord_user_id,
  verified_at,
  created_at,
  updated_at
FROM members;

DROP TABLE members;
ALTER TABLE members_new RENAME TO members;

CREATE INDEX IF NOT EXISTS idx_members_email ON members(email);
CREATE INDEX IF NOT EXISTS idx_members_discord_user_id ON members(discord_user_id);

PRAGMA foreign_keys=on;
