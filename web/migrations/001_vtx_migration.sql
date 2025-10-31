-- VTX Migration: Replace CSV sample storage with VTX binary format
-- Date: 2025-10-30
-- Idempotent: Safe to run multiple times

-- ============================================
-- 1. Drop old tables if they exist
-- ============================================

DROP TABLE IF EXISTS imu_samples CASCADE;
DROP TABLE IF EXISTS imu_data_files CASCADE;

-- ============================================
-- 2. Create recordings table
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
  -- Array of continuous data ranges as [start_ms, end_ms] offsets from start_time
  -- Example: [[0, 30000], [35000, 60000]] means data from 0-30s and 35-60s (5s gap)
  data_ranges INTEGER[][] NOT NULL DEFAULT '{{}}',

  -- Gap statistics (computed from data_ranges)
  gap_info JSONB DEFAULT NULL,
  -- Structure: {
  --   "total_gaps": 2,
  --   "largest_gap_ms": 5000,
  --   "total_gap_duration_ms": 10000,
  --   "gap_percentage": 1.67,
  --   "gap_details": [
  --     {"start_offset_ms": 120000, "end_offset_ms": 125000, "duration_ms": 5000},
  --     {"start_offset_ms": 480000, "end_offset_ms": 485000, "duration_ms": 5000}
  --   ]
  -- }

  -- Sampling info (VTX specific, NULL for FIT files)
  sample_rate REAL,
  sample_count BIGINT,
  record_format INTEGER, -- VTX bitmask for which sensors are included

  -- Device metadata (parsed from file header/metadata)
  device_info JSONB DEFAULT NULL,
  -- Structure: {
  --   "id": "device-uuid",
  --   "name": "Vertex-IMU",
  --   "firmware_version": "1.0.0",
  --   "calibration": {...}
  -- }

  -- Session metadata (user-provided or parsed from file)
  session_metadata JSONB DEFAULT NULL,
  -- Structure: {
  --   "bike": "Road Bike",
  --   "position": "seatpost",
  --   "notes": "Test ride",
  --   "tags": ["training", "smooth-road"],
  --   "weather": "sunny"
  -- }

  -- Computed analysis results (populated by post-processing jobs)
  analysis_results JSONB DEFAULT NULL,
  -- Structure: {
  --   "max_accel_g": 4.2,
  --   "rms_accel_g": 0.8,
  --   "peak_frequencies_hz": [2.5, 5.0, 10.0],
  --   "vibration_score": 72.5
  -- }

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
-- 3. Create indexes for efficient queries
-- ============================================

-- User's recordings list (most common query)
CREATE INDEX IF NOT EXISTS idx_recordings_user_id
  ON recordings(user_id);

-- Time-based queries and filtering
CREATE INDEX IF NOT EXISTS idx_recordings_start_time
  ON recordings(start_time DESC);

-- Status filtering (show ready/processing files)
CREATE INDEX IF NOT EXISTS idx_recordings_status
  ON recordings(status);

-- File type filtering
CREATE INDEX IF NOT EXISTS idx_recordings_file_type
  ON recordings(file_type);

-- Composite index for user's recordings sorted by time
CREATE INDEX IF NOT EXISTS idx_recordings_user_time
  ON recordings(user_id, start_time DESC);

-- GIN indexes for JSONB queries (optional, for advanced filtering)
CREATE INDEX IF NOT EXISTS idx_recordings_gap_info
  ON recordings USING GIN(gap_info);

CREATE INDEX IF NOT EXISTS idx_recordings_device_info
  ON recordings USING GIN(device_info);

CREATE INDEX IF NOT EXISTS idx_recordings_session_metadata
  ON recordings USING GIN(session_metadata);

-- ============================================
-- 4. Create recording_analysis table for derived data
-- ============================================

CREATE TABLE IF NOT EXISTS recording_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Reference to parent recording
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,

  -- Type of analysis performed
  analysis_type TEXT NOT NULL,
  -- Examples: 'power_spectral_density', 'vibration_metrics', 'frequency_analysis', 'ride_quality'

  -- Time range this analysis covers (NULL = entire recording)
  time_range TSTZRANGE,

  -- Analysis results (flexible structure)
  results JSONB NOT NULL,
  -- Structure depends on analysis_type, examples:
  -- 'power_spectral_density': {"frequencies": [...], "powers": [...]}
  -- 'vibration_metrics': {"rms_x": 0.8, "rms_y": 0.6, "rms_z": 1.2}
  -- 'ride_quality': {"smoothness_score": 85, "comfort_index": 72}

  -- Metadata about the analysis
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_version TEXT, -- Track which version of algorithm was used
  parameters JSONB, -- Store analysis parameters for reproducibility

  -- Unique constraint: one analysis of each type per time range per recording
  CONSTRAINT recording_analysis_unique
    UNIQUE (recording_id, analysis_type, time_range)
);

-- Indexes for recording_analysis
CREATE INDEX IF NOT EXISTS idx_recording_analysis_recording
  ON recording_analysis(recording_id);

CREATE INDEX IF NOT EXISTS idx_recording_analysis_type
  ON recording_analysis(analysis_type);

CREATE INDEX IF NOT EXISTS idx_recording_analysis_results
  ON recording_analysis USING GIN(results);

-- ============================================
-- 5. Configure Supabase Storage Bucket
-- ============================================

-- Create recordings bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, 524288000, NULL) -- 500MB limit
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 524288000;

-- Drop existing storage policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can upload their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON storage.objects;

-- Create storage policies for recordings bucket
CREATE POLICY "Users can upload their own recordings"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can update their own recordings"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can read their own recordings"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can delete their own recordings"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'recordings'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Service role can access all recordings (for metadata extraction and processing)
CREATE POLICY "Service role can manage all recordings"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'recordings')
WITH CHECK (bucket_id = 'recordings');

-- ============================================
-- 6. Enable Row Level Security (RLS)
-- ============================================

ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE recording_analysis ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (idempotent)
DROP POLICY IF EXISTS "Users can view their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can insert their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can update their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON recordings;

DROP POLICY IF EXISTS "Users can view analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can insert analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can update analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Users can delete analysis for their recordings" ON recording_analysis;
DROP POLICY IF EXISTS "Service role can manage all recording analysis" ON recording_analysis;

-- Recordings policies
CREATE POLICY "Users can view their own recordings"
  ON recordings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own recordings"
  ON recordings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recordings"
  ON recordings FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recordings"
  ON recordings FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Service role policies (for API uploads and processing)
CREATE POLICY "Service role can manage all recordings"
  ON recordings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Recording analysis policies (check ownership through recordings table)
CREATE POLICY "Users can view analysis for their recordings"
  ON recording_analysis FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM recordings
      WHERE recordings.id = recording_analysis.recording_id
        AND recordings.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert analysis for their recordings"
  ON recording_analysis FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recordings
      WHERE recordings.id = recording_analysis.recording_id
        AND recordings.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update analysis for their recordings"
  ON recording_analysis FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM recordings
      WHERE recordings.id = recording_analysis.recording_id
        AND recordings.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM recordings
      WHERE recordings.id = recording_analysis.recording_id
        AND recordings.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete analysis for their recordings"
  ON recording_analysis FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM recordings
      WHERE recordings.id = recording_analysis.recording_id
        AND recordings.user_id = auth.uid()
    )
  );

-- Service role can manage all recording analysis (for post-processing)
CREATE POLICY "Service role can manage all recording analysis"
  ON recording_analysis FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 7. Create helper functions
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
  -- Sum up all data range durations
  FOREACH range_item SLICE 1 IN ARRAY p_data_ranges
  LOOP
    total_data_duration_ms := total_data_duration_ms + (range_item[2] - range_item[1]);
  END LOOP;

  -- Return gap percentage
  IF p_duration_ms > 0 THEN
    RETURN ROUND((1 - (total_data_duration_ms::NUMERIC / p_duration_ms)) * 100, 2);
  ELSE
    RETURN 0;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================
-- 8. Create updated_at trigger
-- ============================================

-- Drop existing trigger and function if they exist (idempotent)
-- Use CASCADE to handle any dependent triggers
DROP TRIGGER IF EXISTS update_recordings_updated_at ON recordings;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Create trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.processed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger (fires on status change to 'ready')
CREATE TRIGGER update_recordings_updated_at
  BEFORE UPDATE OF status ON recordings
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND OLD.status != 'ready')
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Migration complete
-- ============================================

COMMENT ON TABLE recordings IS 'Stores metadata for VTX and FIT recording files. Raw data stored in Supabase Storage, not in database.';
COMMENT ON TABLE recording_analysis IS 'Stores derived analysis results computed from recording files. Enables caching of expensive computations.';
COMMENT ON COLUMN recordings.data_ranges IS 'Array of [start_ms, end_ms] pairs representing continuous data segments. Used for gap detection and visualization.';
COMMENT ON COLUMN recordings.gap_info IS 'Statistics about data gaps: total count, largest gap, percentage. Computed during upload from data_ranges.';
