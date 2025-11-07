-- Fix integer overflow for duration_ms and data_ranges columns
-- Date: 2025-11-07
-- Issue: INTEGER columns can't handle values > 2,147,483,647 milliseconds (~24 days)
-- Solution: Change to BIGINT to support long recordings

-- Change duration_ms from INTEGER to BIGINT
ALTER TABLE recordings
ALTER COLUMN duration_ms TYPE BIGINT;

-- Change data_ranges from INTEGER[][] to BIGINT[][]
-- This stores timestamp offsets which can exceed INTEGER range for long recordings
ALTER TABLE recordings
ALTER COLUMN data_ranges TYPE BIGINT[][];

-- Also update rides table for consistency
ALTER TABLE rides
ALTER COLUMN duration_seconds TYPE BIGINT;

-- Update helper function parameter types
DROP FUNCTION IF EXISTS compute_gap_percentage(INTEGER, INTEGER[][]);

CREATE OR REPLACE FUNCTION compute_gap_percentage(
  p_duration_ms BIGINT,
  p_data_ranges BIGINT[][]
)
RETURNS NUMERIC AS $$
DECLARE
  total_data_duration_ms BIGINT := 0;
  range_item BIGINT[];
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

COMMENT ON COLUMN recordings.duration_ms IS 'Recording duration in milliseconds (BIGINT supports up to 292 million years)';
COMMENT ON COLUMN recordings.data_ranges IS 'Array of [start_ms, end_ms] pairs as BIGINT to support long recordings';
COMMENT ON COLUMN rides.duration_seconds IS 'Ride duration in seconds (BIGINT for consistency with recordings)';
