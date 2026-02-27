-- Migration: Add surface_roughness analysis type and rename efficiency → stability
-- Date: 2026-02-24
-- RFC: 013-spectral-pedaling-stability
-- Idempotent: Safe to run multiple times

-- ============================================
-- 1. Add surface_roughness to analysis_type CHECK
-- ============================================

ALTER TABLE ride_analysis
  DROP CONSTRAINT IF EXISTS ride_analysis_analysis_type_check;

ALTER TABLE ride_analysis
  ADD CONSTRAINT ride_analysis_analysis_type_check
  CHECK (analysis_type IN ('pedaling_efficiency', 'riding_position', 'surface_roughness'));

-- ============================================
-- 2. Add roughness columns to ride_summaries
-- ============================================

ALTER TABLE ride_summaries
  ADD COLUMN IF NOT EXISTS avg_roughness REAL,
  ADD COLUMN IF NOT EXISTS max_roughness REAL,
  ADD COLUMN IF NOT EXISTS smooth_surface_percent REAL,
  ADD COLUMN IF NOT EXISTS rough_surface_percent REAL;

-- ============================================
-- 3. Rename efficiency columns to stability in ride_summaries
--    (only if old names still exist)
-- ============================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ride_summaries' AND column_name = 'avg_efficiency_percent'
  ) THEN
    ALTER TABLE ride_summaries RENAME COLUMN avg_efficiency_percent TO avg_stability_percent;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ride_summaries' AND column_name = 'smooth_percent'
  ) THEN
    ALTER TABLE ride_summaries RENAME COLUMN smooth_percent TO stable_pedaling_percent;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ride_summaries' AND column_name = 'rough_percent'
  ) THEN
    ALTER TABLE ride_summaries RENAME COLUMN rough_percent TO unstable_pedaling_percent;
  END IF;
END $$;

-- ============================================
-- 4. Add roughness algorithm version to ride_summaries
-- ============================================

ALTER TABLE ride_summaries
  ADD COLUMN IF NOT EXISTS roughness_version TEXT;

-- ============================================
-- 5. Update comments
-- ============================================

COMMENT ON COLUMN ride_analysis.analysis_type IS
  'Type of analysis: pedaling_efficiency (stability metrics), riding_position (standing vs seated), or surface_roughness (road vibration)';

-- ============================================
-- Migration complete
-- ============================================
