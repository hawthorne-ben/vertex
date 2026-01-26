-- Migration: Add ride_analysis table for precomputed analysis results
-- Date: 2026-01-25
-- RFC: 005-pedaling-efficiency-background-processing
-- Idempotent: Safe to run multiple times

-- ============================================
-- 1. Drop unused recording_analysis table (never used)
-- ============================================

DROP TABLE IF EXISTS recording_analysis CASCADE;

-- ============================================
-- 2. Create ride_analysis table
-- ============================================

CREATE TABLE IF NOT EXISTS ride_analysis (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Ride reference
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,

  -- Analysis type (extensible for future analysis types)
  analysis_type TEXT NOT NULL CHECK (analysis_type IN ('pedaling_efficiency')),

  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  -- Computation parameters (for cache invalidation and reproducibility)
  parameters JSONB NOT NULL,
  algorithm_version TEXT NOT NULL,

  -- Results storage
  -- Full time series stored in JSONB (practical limit ~100MB)
  -- For 30min ride @ 25Hz: ~45k samples × 200 bytes = ~9MB (well within limit)
  samples JSONB,

  -- Summary statistics (always populated, even if samples are large)
  metadata JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Ensure one analysis per ride per type
  CONSTRAINT ride_analysis_unique UNIQUE (ride_id, analysis_type)
);

-- ============================================
-- 3. Create indexes
-- ============================================

CREATE INDEX IF NOT EXISTS idx_ride_analysis_ride_id ON ride_analysis(ride_id);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_status ON ride_analysis(status);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_type ON ride_analysis(analysis_type);
CREATE INDEX IF NOT EXISTS idx_ride_analysis_completed ON ride_analysis(completed_at) WHERE completed_at IS NOT NULL;

-- GIN index for JSONB queries (if needed for filtering by metadata)
CREATE INDEX IF NOT EXISTS idx_ride_analysis_metadata ON ride_analysis USING GIN(metadata);

-- ============================================
-- 4. Enable Row Level Security
-- ============================================

ALTER TABLE ride_analysis ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 5. Create RLS Policies
-- ============================================

DROP POLICY IF EXISTS "Users can view analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Users can insert analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Users can update analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Users can delete analysis for their rides" ON ride_analysis;
DROP POLICY IF EXISTS "Service role can manage all ride analysis" ON ride_analysis;

CREATE POLICY "Users can view analysis for their rides" ON ride_analysis FOR SELECT
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Users can insert analysis for their rides" ON ride_analysis FOR INSERT
TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Users can update analysis for their rides" ON ride_analysis FOR UPDATE
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Users can delete analysis for their rides" ON ride_analysis FOR DELETE
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Service role can manage all ride analysis" ON ride_analysis FOR ALL
TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 6. Add table comments
-- ============================================

COMMENT ON TABLE ride_analysis IS 'Stores precomputed analysis results for rides (e.g., pedaling efficiency). Computed asynchronously by Inngest jobs.';
COMMENT ON COLUMN ride_analysis.samples IS 'Full time series data in JSONB format. Null if computation failed or still pending.';
COMMENT ON COLUMN ride_analysis.metadata IS 'Summary statistics and metadata. Always populated on successful completion.';
COMMENT ON COLUMN ride_analysis.algorithm_version IS 'Version string for cache invalidation when algorithm changes.';
COMMENT ON COLUMN ride_analysis.parameters IS 'Computation parameters used (window sizes, thresholds, etc).';

-- ============================================
-- Migration complete
-- ============================================
