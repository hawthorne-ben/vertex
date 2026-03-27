-- Migration: Add braking analysis type and ride_summaries columns
-- Date: 2026-03-12
-- RFC: 014-braking-detection-imu-analysis-rename
-- Idempotent: Safe to run multiple times

-- ============================================
-- 1. Add 'braking' to analysis_type CHECK
-- ============================================

ALTER TABLE ride_analysis
  DROP CONSTRAINT IF EXISTS ride_analysis_analysis_type_check;

ALTER TABLE ride_analysis
  ADD CONSTRAINT ride_analysis_analysis_type_check
  CHECK (analysis_type IN ('pedaling_efficiency', 'riding_position', 'surface_roughness', 'braking'));

-- ============================================
-- 2. Add braking columns to ride_summaries
-- ============================================

ALTER TABLE ride_summaries
  ADD COLUMN IF NOT EXISTS total_braking_events INTEGER,
  ADD COLUMN IF NOT EXISTS braking_percent REAL,
  ADD COLUMN IF NOT EXISTS avg_braking_intensity REAL,
  ADD COLUMN IF NOT EXISTS max_braking_intensity REAL,
  ADD COLUMN IF NOT EXISTS braking_version TEXT;

-- ============================================
-- 3. Update comments
-- ============================================

COMMENT ON COLUMN ride_analysis.analysis_type IS
  'Type of analysis: pedaling_efficiency (stability), riding_position, surface_roughness, or braking';

-- ============================================
-- Migration complete
-- ============================================
