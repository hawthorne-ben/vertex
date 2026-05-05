-- Migration 010b: Backfill denormalized user_id + swap RLS policies (RFC 016)
-- Date: 2026-04-28
--
-- Companion to 010_storage_optimization.sql. Backfills the user_id columns
-- added in 010, then swaps the RLS policies on ride_analysis and
-- ride_recordings from `EXISTS (SELECT ... FROM rides WHERE ...)` to
-- `user_id = auth.uid()`.
--
-- The backfill UPDATE rewrites every ride_analysis row, which still carries
-- the multi-MB `samples` JSONB column at this point. On any non-trivial
-- dataset this exceeds Supabase's web SQL editor 20s statement timeout.
--
-- Run this via psql or the Supabase CLI, NOT the web SQL editor:
--   psql "$DATABASE_URL" < migrations/010b_backfill_user_id.sql
--
-- Or, if you must use the web editor, run the chunked version below.
--
-- Idempotent: safe to re-run.

-- ============================================
-- 1. Backfill ride_analysis.user_id
-- ============================================

UPDATE ride_analysis ra
SET user_id = r.user_id
FROM rides r
WHERE ra.ride_id = r.id AND ra.user_id IS NULL;


-- ============================================
-- 2. Backfill ride_recordings.user_id
-- ============================================

UPDATE ride_recordings rr
SET user_id = r.user_id
FROM rides r
WHERE rr.ride_id = r.id AND rr.user_id IS NULL;


-- ============================================
-- 3. Swap RLS policies to use the denormalized user_id
-- ============================================
-- We do this after backfill so authenticated reads don't see an empty
-- result during the gap (rows with user_id = NULL would fail USING).

-- ride_analysis
DROP POLICY IF EXISTS "Users can view analysis for their rides"   ON ride_analysis;
DROP POLICY IF EXISTS "Users can insert analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Users can update analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Users can delete analysis for their rides" ON ride_analysis;
-- Service role policy unchanged.

CREATE POLICY "Users can view their analyses"   ON ride_analysis FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert their analyses" ON ride_analysis FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their analyses" ON ride_analysis FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete their analyses" ON ride_analysis FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ride_recordings
DROP POLICY IF EXISTS "Users can view ride recordings"   ON ride_recordings;
DROP POLICY IF EXISTS "Users can insert ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Users can delete ride recordings" ON ride_recordings;

CREATE POLICY "Users can view ride recordings"   ON ride_recordings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert ride recordings" ON ride_recordings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete ride recordings" ON ride_recordings FOR DELETE TO authenticated USING (user_id = auth.uid());


-- ============================================
-- Verification
-- ============================================
-- After running, both should return 0:
--   SELECT count(*) FROM ride_analysis   WHERE user_id IS NULL;
--   SELECT count(*) FROM ride_recordings WHERE user_id IS NULL;


-- ============================================
-- CHUNKED ALTERNATIVE (web SQL editor only)
-- ============================================
-- If you cannot use psql / CLI, run these in a loop in the SQL editor.
-- Each iteration updates up to 100 rows and finishes well under 20s.
-- Re-run until "0 rows" is reported. Then run section 3 above separately.
--
-- WITH batch AS (
--   SELECT ra.id
--   FROM ride_analysis ra
--   WHERE ra.user_id IS NULL
--   LIMIT 100
-- )
-- UPDATE ride_analysis ra
-- SET user_id = r.user_id
-- FROM rides r, batch
-- WHERE ra.id = batch.id AND ra.ride_id = r.id;
--
-- WITH batch AS (
--   SELECT rr.id
--   FROM ride_recordings rr
--   WHERE rr.user_id IS NULL
--   LIMIT 100
-- )
-- UPDATE ride_recordings rr
-- SET user_id = r.user_id
-- FROM rides r, batch
-- WHERE rr.id = batch.id AND rr.ride_id = r.id;
