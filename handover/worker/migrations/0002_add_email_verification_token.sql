ALTER TABLE email_verification_codes ADD COLUMN token_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_email_verification_codes_token_hash
  ON email_verification_codes(token_hash);
