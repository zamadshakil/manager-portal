-- Add archive_status column to materials table for tracking async extraction state.
-- Values:
--   na         – not an archive (default for all existing rows)
--   pending    – presigned URL issued; browser upload not yet confirmed
--   processing – registered; background extraction job running
--   done       – extraction + RAG indexing complete
--   failed     – extraction or indexing failed (see activity log for details)

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS archive_status TEXT
    CHECK (archive_status IN ('pending', 'processing', 'done', 'failed', 'na'))
    DEFAULT 'na';

-- Backfill existing rows so the column is consistent
UPDATE public.materials SET archive_status = 'na' WHERE archive_status IS NULL;
