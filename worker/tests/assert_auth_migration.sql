CREATE TABLE auth_migration_assertion (
  value INTEGER NOT NULL CHECK (value = 1)
);

INSERT INTO auth_migration_assertion (value)
SELECT COUNT(*)
FROM email_verification_challenges
WHERE email = 'migration-test@example.ac.jp'
  AND discord_user_id = '123456789012345678';

INSERT INTO auth_migration_assertion (value)
SELECT COUNT(*)
FROM sqlite_master
WHERE type = 'table' AND name = 'oauth_login_states';

INSERT INTO auth_migration_assertion (value)
SELECT COUNT(*)
FROM sqlite_master
WHERE type = 'table' AND name = 'email_verification_codes';

DROP TABLE auth_migration_assertion;
