-- Google Drive mirror for online-class session proofs.
-- Run BY HAND in the Supabase SQL editor (project convention).
--
-- When a teacher attaches a class proof, the server now also copies the
-- screenshot into the institute Drive (same root as lesson plans / PPTs)
-- under:  Online Class Proof / <Grade-Division> / <file>
-- This column stores the resulting Drive webViewLink (NULL = not mirrored,
-- e.g. Drive not configured or the upload predates this feature).

ALTER TABLE public.session_proofs ADD COLUMN IF NOT EXISTS drive_link TEXT;
