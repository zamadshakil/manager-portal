-- Add late_submission_deadline to tasks table
ALTER TABLE tasks ADD COLUMN late_submission_deadline timestamptz;
