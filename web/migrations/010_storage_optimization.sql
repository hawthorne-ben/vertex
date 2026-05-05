-- Migration 010a: Database Storage Optimization — schema only (RFC 016)
-- Date: 2026-04-28
--
-- Forward delta from 009 to the post-RFC-016 state, schema-only portion.
-- Adds Storage-pointer columns to ride_analysis, adds nullable denormalized
-- user_id columns, drops unused JSONB GIN indexes, and creates the
-- ride-analyses Storage bucket. Backfill + RLS policy swap live in 010b.
--
-- The companion migration `010b_backfill_user_id.sql` backfills the new
-- user_id columns. It is split out because the UPDATE rewrites every
-- ride_analysis row (each carrying multi-MB `samples` JSONB) and exceeds
-- Supabase's web SQL editor 20s statement timeout. Run 010b via the
-- Supabase CLI / psql, or chunked.
--
-- The denormalized `user_id` columns stay NULLABLE through this migration
-- and 010b. They become NOT NULL in a follow-up migration only after the
-- application code is updated to populate user_id on every insert site
-- (parse-fit, recordings/route.ts, analyze-ride-imu).
--
-- Idempotent: safe to re-run.

-- ============================================
-- 1. ride_analysis: add Storage-pointer columns + user_id
-- ============================================

ALTER TABLE ride_analysis
  ADD COLUMN IF NOT EXISTS samples_path TEXT,
  ADD COLUMN IF NOT EXISTS samples_size_bytes INTEGER,
  ADD COLUMN IF NOT EXISTS sample_count INTEGER,
  ADD COLUMN IF NOT EXISTS sample_rate_hz REAL,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;


-- ============================================
-- 2. ride_recordings: add denormalized user_id column (nullable)
-- ============================================

ALTER TABLE ride_recordings
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Backfill the new user_id columns happens in 010b_backfill_user_id.sql.


-- ============================================
-- 3. New indexes for the denormalized RLS path
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ride_analysis_ride_user
  ON ride_analysis(user_id, ride_id);

CREATE INDEX IF NOT EXISTS idx_ride_analysis_pending
  ON ride_analysis(ride_id) WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_ride_recordings_user
  ON ride_recordings(user_id);


-- ============================================
-- 4. Drop unused JSONB GIN indexes (write amplification on hot path)
-- ============================================

DROP INDEX IF EXISTS idx_recordings_gap_info;
DROP INDEX IF EXISTS idx_recordings_device_info;
DROP INDEX IF EXISTS idx_recordings_session_metadata;
DROP INDEX IF EXISTS idx_ride_analysis_metadata;


-- ============================================
-- 5. Storage bucket for analysis sample blobs
-- ============================================
-- Path convention: {user_id}/{ride_id}/{analysis_type}-{algorithm_version}.json.gz

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ride-analyses', 'ride-analyses', false, 104857600, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 104857600;

DROP POLICY IF EXISTS "Users can read their own ride analyses" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all ride analyses" ON storage.objects;

CREATE POLICY "Users can read their own ride analyses" ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ride-analyses' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all ride analyses" ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'ride-analyses')
WITH CHECK (bucket_id = 'ride-analyses');


-- ============================================
-- 6. Comments
-- ============================================

COMMENT ON COLUMN ride_analysis.samples_path  IS 'Path inside the ride-analyses bucket. Format: {user_id}/{ride_id}/{analysis_type}-{algorithm_version}.json.gz';
COMMENT ON COLUMN ride_analysis.user_id       IS 'Denormalized from rides.user_id for cheaper RLS evaluation. Maintained by application code.';
COMMENT ON COLUMN ride_recordings.user_id     IS 'Denormalized from rides.user_id for cheaper RLS evaluation. Maintained by application code.';
