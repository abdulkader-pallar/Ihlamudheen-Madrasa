-- Add the missing UNIQUE constraint on exam_scores so that
-- upsert with onConflict:"exam_id,student_id,subject_id" works.
-- Removes any duplicate rows first (keep the row with the highest id).

DELETE FROM public.exam_scores a
USING public.exam_scores b
WHERE a.id < b.id
  AND a.exam_id    = b.exam_id
  AND a.student_id = b.student_id
  AND a.subject_id = b.subject_id;

ALTER TABLE public.exam_scores
  DROP CONSTRAINT IF EXISTS exam_scores_unique_combo;

ALTER TABLE public.exam_scores
  ADD CONSTRAINT exam_scores_unique_combo
  UNIQUE (exam_id, student_id, subject_id);
