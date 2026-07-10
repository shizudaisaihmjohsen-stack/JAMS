-- Chairperson numbers use their own C-series instead of sharing the RC R-series.
UPDATE members AS target
SET member_no = 'C' || (
  SELECT COUNT(*)
  FROM members AS candidate
  WHERE candidate.committee_type = '委員長'
    AND (
      candidate.student_id < target.student_id
      OR (candidate.student_id = target.student_id AND candidate.id <= target.id)
    )
)
WHERE target.committee_type = '委員長';
