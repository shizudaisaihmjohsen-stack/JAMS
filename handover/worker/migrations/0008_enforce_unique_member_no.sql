CREATE UNIQUE INDEX IF NOT EXISTS idx_members_member_no
  ON members(member_no)
  WHERE member_no IS NOT NULL AND trim(member_no) <> '';
