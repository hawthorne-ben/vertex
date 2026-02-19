-- 007_ride_summaries.sql
-- RFC 011: Longitudinal Metrics and Trends Infrastructure
--
-- One row per ride with flat, typed columns for cross-ride aggregation.
-- No JSONB — every column is queryable, indexable, aggregatable with plain SQL.

CREATE TABLE ride_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Ride context (denormalized from rides table for query efficiency)
  ride_started_at TIMESTAMPTZ NOT NULL,
  duration_seconds BIGINT NOT NULL,
  distance_meters REAL,
  elevation_gain_meters REAL,

  -- FIT-derived basics (from recordings.analysis_results)
  avg_speed_ms REAL,
  avg_heart_rate REAL,
  avg_power_watts REAL,
  avg_cadence REAL,
  max_heart_rate REAL,
  max_power_watts REAL,
  max_cadence REAL,
  normalized_power_watts REAL,

  -- IMU-derived: Pedaling Efficiency (from ride_analysis)
  avg_efficiency_percent REAL,
  smooth_percent REAL,
  rough_percent REAL,
  pedaling_percent REAL,

  -- IMU-derived: Riding Position (from ride_analysis)
  standing_percent REAL,
  seated_percent REAL,
  avg_cadence_standing REAL,
  avg_cadence_seated REAL,

  -- IMU-derived: Future metrics (nullable, populated as algorithms ship)
  braking_smoothness_score REAL,
  cornering_stability_score REAL,
  sprint_count INTEGER,
  avg_sprint_power_watts REAL,

  -- Algorithm versioning (per-metric, nullable when metric not yet computed)
  efficiency_version TEXT,
  position_version TEXT,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ride_summaries_ride_unique UNIQUE (ride_id)
);

-- Query patterns: user's rides ordered by date, filtered by date range
CREATE INDEX idx_ride_summaries_user_date ON ride_summaries(user_id, ride_started_at DESC);

-- Aggregation queries
CREATE INDEX idx_ride_summaries_user_id ON ride_summaries(user_id);

-- Row Level Security
ALTER TABLE ride_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own summaries" ON ride_summaries
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role can manage all summaries" ON ride_summaries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
