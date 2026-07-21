ALTER TABLE discord_dm_inbox
ADD COLUMN direction TEXT NOT NULL DEFAULT 'incoming'
CHECK (direction IN ('incoming', 'outgoing'));

CREATE INDEX IF NOT EXISTS idx_discord_dm_inbox_direction
  ON discord_dm_inbox(direction);
