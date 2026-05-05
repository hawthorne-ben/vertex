-- ===================================================================
-- Vertex DB Baseline
-- ===================================================================
-- Single source of truth for the current schema. Run this on a fresh
-- environment to bring it to the post-RFC-016 state in one shot.
-- Existing environments do NOT run this; they use the numbered
-- forward-delta migrations (001 through 010).
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every DROP uses IF
-- EXISTS, every policy is dropped before recreation. Safe to re-run.
-- ===================================================================


-- ===================================================================
-- 1. Tables
-- ===================================================================

-- Waitlist (pre-product email signups)
CREATE TABLE IF NOT EXISTS waitlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT waitlist_email_check CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Recordings: one row per uploaded VTX or FIT file. Bulky data lives
-- in Supabase Storage; this row holds metadata only.
CREATE TABLE IF NOT EXISTS recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('vtx', 'fit')),
  storage_path TEXT NOT NULL UNIQUE,
  file_size_bytes BIGINT NOT NULL,

  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms BIGINT NOT NULL,

  data_ranges BIGINT[][] NOT NULL DEFAULT '{{}}',

  -- These JSONB columns are read by id only; not GIN-indexed.
  gap_info JSONB,
  device_info JSONB,
  session_metadata JSONB,
  analysis_results JSONB,

  sample_rate REAL,
  sample_count BIGINT,
  record_format INTEGER,

  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error_message TEXT,

  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  CONSTRAINT recordings_user_filename_key UNIQUE (user_id, filename)
);

-- Rides: user-created groupings of one or more recordings.
CREATE TABLE IF NOT EXISTS rides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_seconds BIGINT NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,
  bike_type TEXT,
  conditions TEXT,

  -- Merged VTX file (single concatenated blob covering the whole ride)
  merged_vtx_path TEXT,
  merged_vtx_file_size_bytes BIGINT,
  merged_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ride ↔ recording junction. user_id denormalized for cheap RLS.
CREATE TABLE IF NOT EXISTS ride_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ride_recordings_unique UNIQUE (ride_id, recording_id)
);

-- Ride analysis: status + small metadata + Storage pointer to bulky samples.
-- The actual samples blob lives at samples_path in Supabase Storage as
-- gzipped JSON. Keeping it out of the row keeps polls and list queries cheap.
CREATE TABLE IF NOT EXISTS ride_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  analysis_type TEXT NOT NULL CHECK (
    analysis_type IN ('pedaling_efficiency', 'riding_position', 'surface_roughness', 'braking')
  ),

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  algorithm_version TEXT NOT NULL,
  parameters JSONB NOT NULL,
  metadata JSONB NOT NULL,

  -- Storage pointer for the time-series samples blob. Null until completed.
  samples_path TEXT,
  samples_size_bytes INTEGER,
  sample_count INTEGER,
  sample_rate_hz REAL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  CONSTRAINT ride_analysis_unique UNIQUE (ride_id, analysis_type)
);

-- Ride summaries: one flat row per ride, denormalized scalars for trends/aggregation.
CREATE TABLE IF NOT EXISTS ride_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  ride_started_at TIMESTAMPTZ NOT NULL,
  duration_seconds BIGINT NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,

  -- FIT-derived
  avg_speed_ms REAL,
  avg_heart_rate REAL,
  avg_power_watts REAL,
  avg_cadence REAL,
  max_heart_rate REAL,
  max_power_watts REAL,
  max_cadence REAL,
  normalized_power_watts REAL,

  -- Pedaling stability (renamed from "efficiency")
  avg_stability_percent REAL,
  stable_pedaling_percent REAL,
  unstable_pedaling_percent REAL,
  pedaling_percent REAL,

  -- Riding position
  standing_percent REAL,
  seated_percent REAL,
  avg_cadence_standing REAL,
  avg_cadence_seated REAL,

  -- Surface roughness
  avg_roughness REAL,
  max_roughness REAL,
  smooth_surface_percent REAL,
  rough_surface_percent REAL,

  -- Braking
  total_braking_events INTEGER,
  braking_percent REAL,
  avg_braking_intensity REAL,
  max_braking_intensity REAL,

  -- Reserved for future metrics
  cornering_stability_score REAL,
  sprint_count INTEGER,
  avg_sprint_power_watts REAL,

  -- Per-metric algorithm version (nullable until that metric ships for this ride)
  efficiency_version TEXT,
  position_version TEXT,
  roughness_version TEXT,
  braking_version TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ride_summaries_ride_unique UNIQUE (ride_id)
);


-- ===================================================================
-- 2. Indexes
-- ===================================================================

-- Recordings
CREATE INDEX IF NOT EXISTS idx_recordings_user_id     ON recordings(user_id);
CREATE INDEX IF NOT EXISTS idx_recordings_user_time   ON recordings(user_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_status      ON recordings(status);
CREATE INDEX IF NOT EXISTS idx_recordings_file_type   ON recordings(file_type);
-- Note: GIN indexes on JSONB columns intentionally omitted. Those columns
-- are read by id only; GIN write amplification was costing us on hot paths.

-- Rides
CREATE INDEX IF NOT EXISTS idx_rides_user_id          ON rides(user_id);
CREATE INDEX IF NOT EXISTS idx_rides_user_start_time  ON rides(user_id, start_time);
CREATE INDEX IF NOT EXISTS idx_rides_merged_vtx_path  ON rides(merged_vtx_path) WHERE merged_vtx_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rides_merged_at        ON rides(merged_at) WHERE merged_at IS NOT NULL;

-- Ride recordings
CREATE INDEX IF NOT EXISTS idx_ride_recordings_ride       ON ride_recordings(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_recordings_recording  ON ride_recordings(recording_id);
CREATE INDEX IF NOT EXISTS idx_ride_recordings_user       ON ride_recordings(user_id);

-- Ride analysis
CREATE INDEX IF NOT EXISTS idx_ride_analysis_ride_user   ON ride_analysis(user_id, ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_status      ON ride_analysis(status);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_type        ON ride_analysis(analysis_type);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_pending
  ON ride_analysis(ride_id) WHERE status IN ('pending', 'processing');

-- Ride summaries
CREATE INDEX IF NOT EXISTS idx_ride_summaries_user_date ON ride_summaries(user_id, ride_started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ride_summaries_user_id   ON ride_summaries(user_id);

-- Waitlist
CREATE INDEX IF NOT EXISTS idx_waitlist_email      ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);


-- ===================================================================
-- 3. Functions
-- ===================================================================

-- Gap percentage from data_ranges array
CREATE OR REPLACE FUNCTION compute_gap_percentage(
  p_duration_ms BIGINT,
  p_data_ranges BIGINT[][]
) RETURNS NUMERIC AS $$
DECLARE
  total_data_duration_ms BIGINT := 0;
  range_item BIGINT[];
BEGIN
  FOREACH range_item SLICE 1 IN ARRAY p_data_ranges LOOP
    total_data_duration_ms := total_data_duration_ms + (range_item[2] - range_item[1]);
  END LOOP;

  IF p_duration_ms > 0 THEN
    RETURN ROUND((1 - (total_data_duration_ms::NUMERIC / p_duration_ms)) * 100, 2);
  ELSE
    RETURN 0;
  END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION update_rides_updated_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_recording_processed_at_column() RETURNS TRIGGER AS $$
BEGIN
  NEW.processed_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ===================================================================
-- 4. Triggers
-- ===================================================================

DROP TRIGGER IF EXISTS update_rides_updated_at ON rides;
CREATE TRIGGER update_rides_updated_at
  BEFORE UPDATE ON rides
  FOR EACH ROW
  EXECUTE FUNCTION update_rides_updated_at_column();

DROP TRIGGER IF EXISTS update_recordings_processed_at ON recordings;
CREATE TRIGGER update_recordings_processed_at
  BEFORE UPDATE OF status ON recordings
  FOR EACH ROW
  WHEN (NEW.status = 'ready' AND OLD.status != 'ready')
  EXECUTE FUNCTION update_recording_processed_at_column();


-- ===================================================================
-- 5. Storage Buckets
-- ===================================================================

-- Recordings bucket: raw VTX/FIT uploads + merged VTX blobs
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('recordings', 'recordings', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 524288000;

-- Uploads bucket: chunked upload staging area
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', false, 524288000, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 524288000;

-- Ride analyses bucket: gzipped JSON blobs for time-series sample data
-- Path convention: {user_id}/{ride_id}/{analysis_type}-{algorithm_version}.json.gz
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ride-analyses', 'ride-analyses', false, 104857600, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 104857600;


-- ===================================================================
-- 6. Storage Policies
-- ===================================================================

-- Recordings bucket
DROP POLICY IF EXISTS "Users can upload their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can update their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON storage.objects;

CREATE POLICY "Users can upload their own recordings" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own recordings" ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read their own recordings" ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own recordings" ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'recordings' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all recordings" ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'recordings')
WITH CHECK (bucket_id = 'recordings');

-- Uploads bucket
DROP POLICY IF EXISTS "Users can upload chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all uploads" ON storage.objects;

CREATE POLICY "Users can upload chunks" ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can read their own chunks" ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'uploads' AND (auth.uid()::text = (storage.foldername(name))[1] OR name LIKE 'chunks/%'));

CREATE POLICY "Users can delete their own chunks" ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'uploads' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all uploads" ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- Ride analyses bucket
DROP POLICY IF EXISTS "Users can read their own ride analyses" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all ride analyses" ON storage.objects;

CREATE POLICY "Users can read their own ride analyses" ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'ride-analyses' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Service role can manage all ride analyses" ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'ride-analyses')
WITH CHECK (bucket_id = 'ride-analyses');


-- ===================================================================
-- 7. Row Level Security
-- ===================================================================

ALTER TABLE recordings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rides           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_analysis   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ride_summaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist        ENABLE ROW LEVEL SECURITY;


-- Recordings policies
DROP POLICY IF EXISTS "Users can view their own recordings"   ON recordings;
DROP POLICY IF EXISTS "Users can insert their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can update their own recordings" ON recordings;
DROP POLICY IF EXISTS "Users can delete their own recordings" ON recordings;
DROP POLICY IF EXISTS "Service role can manage all recordings" ON recordings;

CREATE POLICY "Users can view their own recordings"   ON recordings FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own recordings" ON recordings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own recordings" ON recordings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own recordings" ON recordings FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage all recordings" ON recordings FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Rides policies
DROP POLICY IF EXISTS "Users can view their own rides"   ON rides;
DROP POLICY IF EXISTS "Users can insert their own rides" ON rides;
DROP POLICY IF EXISTS "Users can update their own rides" ON rides;
DROP POLICY IF EXISTS "Users can delete their own rides" ON rides;
DROP POLICY IF EXISTS "Service role can manage all rides" ON rides;

CREATE POLICY "Users can view their own rides"   ON rides FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own rides" ON rides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own rides" ON rides FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own rides" ON rides FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage all rides" ON rides FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Ride recordings policies (denormalized user_id → no EXISTS subquery)
DROP POLICY IF EXISTS "Users can view ride recordings"   ON ride_recordings;
DROP POLICY IF EXISTS "Users can insert ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Users can delete ride recordings" ON ride_recordings;
DROP POLICY IF EXISTS "Service role can manage all ride recordings" ON ride_recordings;

CREATE POLICY "Users can view ride recordings"   ON ride_recordings FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert ride recordings" ON ride_recordings FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete ride recordings" ON ride_recordings FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role can manage all ride recordings" ON ride_recordings FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Ride analysis policies (denormalized user_id → no EXISTS subquery)
DROP POLICY IF EXISTS "Users can view their analyses"   ON ride_analysis;
DROP POLICY IF EXISTS "Users can insert their analyses" ON ride_analysis;
DROP POLICY IF EXISTS "Users can update their analyses" ON ride_analysis;
DROP POLICY IF EXISTS "Users can delete their analyses" ON ride_analysis;
DROP POLICY IF EXISTS "Service role can manage all ride analysis" ON ride_analysis;

CREATE POLICY "Users can view their analyses"   ON ride_analysis FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Users can insert their analyses" ON ride_analysis FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can update their analyses" ON ride_analysis FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Users can delete their analyses" ON ride_analysis FOR DELETE TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role can manage all ride analysis" ON ride_analysis FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Ride summaries policies
DROP POLICY IF EXISTS "Users can view their own summaries" ON ride_summaries;
DROP POLICY IF EXISTS "Service role can manage all summaries" ON ride_summaries;

CREATE POLICY "Users can view their own summaries" ON ride_summaries FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role can manage all summaries" ON ride_summaries FOR ALL TO service_role USING (true) WITH CHECK (true);


-- Waitlist policies
DROP POLICY IF EXISTS "Anyone can join waitlist" ON waitlist;
DROP POLICY IF EXISTS "Service role can manage waitlist" ON waitlist;

CREATE POLICY "Anyone can join waitlist" ON waitlist FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Service role can manage waitlist" ON waitlist FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ===================================================================
-- 8. Comments
-- ===================================================================

COMMENT ON TABLE recordings        IS 'Unified storage for VTX and FIT files. Raw bytes live in Supabase Storage; this table holds metadata only.';
COMMENT ON TABLE rides             IS 'User-created rides combining one or more recordings.';
COMMENT ON TABLE ride_recordings   IS 'Junction between rides and recordings. user_id denormalized for cheap RLS.';
COMMENT ON TABLE ride_analysis     IS 'Per-ride analysis results. The bulky time-series samples blob lives at samples_path in Supabase Storage; this row holds status, metadata, and the pointer.';
COMMENT ON TABLE ride_summaries    IS 'One flat row per ride with denormalized scalar metrics for cross-ride trends.';
COMMENT ON COLUMN ride_analysis.samples_path IS 'Path inside the ride-analyses bucket. Format: {user_id}/{ride_id}/{analysis_type}-{algorithm_version}.json.gz';
COMMENT ON COLUMN ride_analysis.metadata     IS 'Summary scalars (avg, max, percent values). Always populated on completion.';
COMMENT ON COLUMN recordings.data_ranges     IS 'BIGINT[][] of [start_ms, end_ms] offsets representing continuous data segments.';
