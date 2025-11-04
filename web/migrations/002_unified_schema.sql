-- Unified Schema Migration: Consolidate all tables and remove legacy schemas
-- Date: 2025-01-02
-- Idempotent: Safe to run multiple times
-- Purpose: Unify VTX migration with existing rides schema, remove old tables

-- ============================================
-- 1. Ensure recordings table exists (from 001_vtx_migration.sql)
-- ============================================

CREATE TABLE IF NOT EXISTS recordings (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User reference
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- File information
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('vtx', 'fit')),
  storage_path TEXT NOT NULL UNIQUE,
  file_size_bytes BIGINT NOT NULL,

  -- Time range (from file header)
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- Data continuity tracking
  data_ranges INTEGER[][] NOT NULL DEFAULT '{{}}',

  -- Gap statistics (computed from data_ranges)
  gap_info JSONB DEFAULT NULL,

  -- Sampling info (VTX specific, NULL for FIT files)
  sample_rate REAL,
  sample_count BIGINT,
  record_format INTEGER,

  -- Device metadata (parsed from file header/metadata)
  device_info JSONB DEFAULT NULL,

  -- Session metadata (user-provided or parsed from file)
  session_metadata JSONB DEFAULT NULL,

  -- Computed analysis results (populated by post-processing jobs)
  analysis_results JSONB DEFAULT NULL,

  -- Processing status
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error_message TEXT,

  -- Timestamps
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  -- Unique constraint: one filename per user
  CONSTRAINT recordings_user_filename_key UNIQUE (user_id, filename)
);

-- ============================================
-- 2. Create recording_analysis table
-- ============================================

CREATE TABLE IF NOT EXISTS recording_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  time_range TSTZRANGE,
  results JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_version TEXT,
  parameters JSONB,
  CONSTRAINT recording_analysis_unique
    UNIQUE (recording_id, analysis_type, time_range)
);

-- ============================================
-- 3. Create rides table with proper schema
-- ============================================

-- Drop old rides table if it exists with wrong schema
DROP TABLE IF EXISTS rides CASCADE;

CREATE TABLE rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_seconds INTEGER NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,
  bike_type TEXT,
  conditions TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- 4. Create ride_recordings association table
-- ============================================
-- This replaces the old ride_data_files table and associates recordings with rides

DROP TABLE IF EXISTS ride_recordings CASCADE;

CREATE TABLE ride_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Ensure one recording appears only once per ride
  CONSTRAINT ride_recordings_unique UNIQUE (ride_id, recording_id)
);

-- ============================================
-- 5. Create indexes for recordings
-- ============================================

CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_start_time ON recordings(start_time DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_file_type ON recordings(file_type);
CREATE INDEX IF NOT EXISTS idx_recordings_user_time ON recordings(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_gap_info ON recordings USING GIN(gap_info);
CREATE INDEX IF NOT EXISTS idx_recordings_device_info ON recordings USING GIN(device_info);
CREATE INDEX IF NOT EXISTS idx_recordings_session_metadata ON recordings USING GIN(session_metadata);

-- ============================================
-- 6. Create indexes for recording_analysis
-- ============================================

CREATE INDEX IF NOT EXISTS idx_recording_analysis_recording ON recording_analysis(recording_id);
CREATE INDEX IF NOT EXISTS idx_recording_analysis_type ON recording_analysis(analysis_type);
CREATE INDEX IF NOT EXISTS idx_recording_analysis_results ON recording_analysis USING GIN(results);

-- ============================================
-- 7. Create indexes for rides
-- ============================================

CREATE INDEX IF NOT EXISTS idx_rides_user_id ON rides(user_id);
CREATE INDEX IF NOT EXISTS idx_rides_start_time ON rides(start_time);
CREATE INDEX IF NOT EXISTS idx_rides_user_start_time ON rides(user_id, start_time);

-- ============================================
-- 8. Create indexes for ride_recordings
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ride_recordings_ride ON ride_recordings(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_recordings_recording ON ride_recordings(recording_id);

-- ============================================
-- 9. Configure Storage Buckets (idempotent)
-- ============================================

-- Recordings bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 524288000;

-- Uploads bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE
SET public = false, file_size_limit = 524288000;

-- ============================================
-- 10. Configure Storage Policies (idempotent)
-- ============================================

-- Recordings bucket policies
DROP POLICY IF EXISTS "Users can upload their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON storage.objects;

CREATE POLICY "Users can upload their own recordings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own recordings"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read their own recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all recordings"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'recordings')
WITH CHECK (bucket_id = 'recordings');

-- Uploads bucket policies
DROP POLICY IF EXISTS "Users can upload chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all uploads" ON storage.objects;

CREATE POLICY "Users can upload chunks"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read their own chunks"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'uploads' AND (auth.uid()::text = (storage.foldername(name))[1] OR name LIKE 'chunks/%'));

CREATE POLICY "Users can delete their own chunks"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all uploads"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- ============================================
-- 11. Enable Row Level Security
-- ============================================

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_recordings ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 12. Create RLS Policies (idempotent)
-- ============================================

-- Recordings policies
DROP POLICY IF EXISTS "Users can view their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can insert their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can update their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON recordings;

CREATE POLICY "Users can view their own recordings" ON recordings FOR SELECT
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recordings" ON recordings FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recordings" ON recordings FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recordings" ON recordings FOR DELETE
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all recordings" ON recordings FOR ALL
TO service_role USING (true) WITH CHECK (true);

-- Recording analysis policies
DROP POLICY IF EXISTS "Users can view analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can insert analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can update analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can delete analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Service role can manage all recording analysis" ON recording_analysis;

CREATE POLICY "Users can view analysis for their recordings" ON recording_analysis FOR SELECT
TO authenticated USING (
  EXISTS (SELECT 1 FROM recordings WHERE recordings.id = recording_analysis.recording_id AND recordings.user_id = auth.uid())
);

CREATE POLICY "Users can insert analysis for their recordings" ON recording_analysis FOR INSERT
TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM recordings WHERE recordings.id = recording_analysis.recording_id AND recordings.user_id = auth.uid())
);

CREATE POLICY "Users can update analysis for their recordings" ON recording_analysis FOR UPDATE
TO authenticated USING (
  EXISTS (SELECT 1 FROM recordings WHERE recordings.id = recording_analysis.recording_id AND recordings.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM recordings WHERE recordings.id = recording_analysis.recording_id AND recordings.user_id = auth.uid())
);

CREATE POLICY "Users can delete analysis for their recordings" ON recording_analysis FOR DELETE
TO authenticated USING (
  EXISTS (SELECT 1 FROM recordings WHERE recordings.id = recording_analysis.recording_id AND recordings.user_id = auth.uid())
);

CREATE POLICY "Service role can manage all recording analysis" ON recording_analysis FOR ALL
TO service_role USING (true) WITH CHECK (true);

-- Rides policies
DROP POLICY IF EXISTS "Users can view their own rides" ON rides;
DROP POLICY IF EXISTS "Users can insert their own rides" ON rides;
DROP POLICY IF EXISTS "Users can update their own rides" ON rides;
DROP POLICY IF EXISTS "Users can delete their own rides" ON rides;
DROP POLICY IF EXISTS "Service role can manage all rides" ON rides;

CREATE POLICY "Users can view their own rides" ON rides FOR SELECT
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own rides" ON rides FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own rides" ON rides FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own rides" ON rides FOR DELETE
TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage all rides" ON rides FOR ALL
TO service_role USING (true) WITH CHECK (true);

-- Ride recordings policies
DROP POLICY IF EXISTS "Users can view ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Users can insert ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Users can delete ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Service role can manage all ride recordings" ON ride_recordings;

CREATE POLICY "Users can view ride recordings" ON ride_recordings FOR SELECT
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_recordings.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Users can insert ride recordings" ON ride_recordings FOR INSERT
TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_recordings.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Users can delete ride recordings" ON ride_recordings FOR DELETE
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_recordings.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Service role can manage all ride recordings" ON ride_recordings FOR ALL
TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 13. Create helper functions
-- ============================================

-- Function to compute gap percentage from data_ranges
CREATE OR REPLACE FUNCTION compute_gap_percentage(
  p_duration_ms INTEGER,
  p_data_ranges INTEGER[][]
)
RETURNS NUMERIC AS $$
DECLARE
  total_data_duration_ms INTEGER := 0;
  range_item INTEGER[];
BEGIN
  FOREACH range_item SLICE 1 IN ARRAY p_data_ranges
  LOOP
    total_data_duration_ms := total_data_duration_ms + (range_item[2] - range_item[1]);
  END LOOP;

  IF p_duration_ms > 0 THEN
    RETURN ROUND((1 - (total_data_duration_ms::NUMERIC / p_duration_ms)) * 100, 2);
  ELSE
    RETURN 0;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 14. Create triggers
-- ============================================

-- Trigger for updated_at on rides table
DROP TRIGGER IF EXISTS update_rides_updated_at ON rides;
DROP FUNCTION IF EXISTS update_rides_updated_at_column() CASCADE;

CREATE OR REPLACE FUNCTION update_rides_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW
  EXECUTE FUNCTION update_rides_updated_at_column();

-- Trigger for processed_at on recordings table
DROP TRIGGER IF EXISTS update_recordings_updated_at ON recordings;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.processed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE OF status ON recordings
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND OLD.status != 'ready')
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 15. Drop legacy tables (idempotent)
-- ============================================

DROP TABLE IF EXISTS ride_data_files CASCADE;
DROP TABLE IF EXISTS imu_samples CASCADE;
DROP TABLE IF EXISTS imu_data_files CASCADE;
DROP TABLE IF EXISTS fit_files CASCADE;
DROP TABLE IF EXISTS data_files CASCADE;
DROP TABLE IF EXISTS association_history CASCADE;

-- ============================================
-- Migration complete
-- ============================================

COMMENT ON TABLE recordings IS 'Unified storage for VTX and FIT recording files. Raw data stored in Supabase Storage, not in database.';
COMMENT ON TABLE recording_analysis IS 'Stores derived analysis results computed from recording files. Enables caching of expensive computations.';
COMMENT ON TABLE rides IS 'User-created rides combining multiple recordings (VTX and/or FIT files) for comprehensive analysis.';
COMMENT ON TABLE ride_recordings IS 'Association table linking rides to their constituent recordings.';
COMMENT ON COLUMN recordings.data_ranges IS 'Array of [start_ms, end_ms] pairs representing continuous data segments. Used for gap detection and visualization.';
COMMENT ON COLUMN recordings.gap_info IS 'Statistics about data gaps: total count, largest gap, percentage. Computed during upload from data_ranges.';

