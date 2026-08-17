CREATE TABLE IF NOT EXISTS scheduled_discord_posts (
  post_key TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  thread_id TEXT,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scheduled_discord_posts_channel_id
  ON scheduled_discord_posts(channel_id);
