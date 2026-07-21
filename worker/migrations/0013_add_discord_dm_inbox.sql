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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_received_at
  ON discord_dm_inbox(received_at);
CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_author_id
  ON discord_dm_inbox(author_id);
