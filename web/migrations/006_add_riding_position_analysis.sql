-- Migration: Add riding_position analysis type support
-- Date: 2026-02-12
-- RFC: 010-pedaling-position-detection
-- Idempotent: Safe to run multiple times

-- ============================================
-- 1. Drop existing CHECK constraint
-- ============================================

ALTER TABLE ride_analysis
  DROP CONSTRAINT IF EXISTS ride_analysis_analysis_type_check;

-- ============================================
-- 2. Add new CHECK constraint with riding_position
-- ============================================

ALTER TABLE ride_analysis
  ADD CONSTRAINT ride_analysis_analysis_type_check
  CHECK (analysis_type IN ('pedaling_efficiency', 'riding_position'));

-- ============================================
-- 3. Add comment
-- ============================================

COMMENT ON COLUMN ride_analysis.analysis_type IS
  'Type of analysis: pedaling_efficiency (smoothness metrics) or riding_position (standing vs seated detection)';

-- ============================================
-- Migration complete
-- ============================================
