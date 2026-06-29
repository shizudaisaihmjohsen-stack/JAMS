INSERT INTO email_verification_challenges (
  challenge_id,
  email,
  discord_user_id,
  code_hash,
  expires_at,
  attempts,
  created_at
) VALUES
  ('challenge-a', 'concurrent@example.ac.jp', 'discord-a', 'hash-a', 4102444800000, 0, 1),
  ('challenge-b', 'concurrent@example.ac.jp', 'discord-b', 'hash-b', 4102444800000, 0, 2);

INSERT INTO email_verification_challenges (
  challenge_id,
  email,
  discord_user_id,
  code_hash,
  expires_at,
  attempts,
  created_at
) VALUES (
  'challenge-a-retry',
  'concurrent@example.ac.jp',
  'discord-a',
  'hash-a-retry',
  4102444800000,
  0,
  3
)
ON CONFLICT(email, discord_user_id) DO UPDATE SET
  challenge_id = excluded.challenge_id,
  code_hash = excluded.code_hash,
  expires_at = excluded.expires_at,
  attempts = excluded.attempts,
  created_at = excluded.created_at;

CREATE TABLE auth_schema_assertion (
  value INTEGER NOT NULL CHECK (value = 1)
);

INSERT INTO auth_schema_assertion (value)
SELECT COUNT(*) = 2
FROM email_verification_challenges
WHERE email = 'concurrent@example.ac.jp';

INSERT INTO auth_schema_assertion (value)
SELECT COUNT(*) = 1
FROM email_verification_challenges
WHERE challenge_id = 'challenge-a-retry' AND code_hash = 'hash-a-retry';

DROP TABLE auth_schema_assertion;
DELETE FROM email_verification_challenges WHERE email = 'concurrent@example.ac.jp';
