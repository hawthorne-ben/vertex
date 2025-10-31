-- VTX Migration Validation Queries
-- Run these in Supabase SQL Editor to validate the migration

-- ============================================
-- 1. Overview of all recordings
-- ============================================
SELECT
  id,
  filename,
  file_type,
  file_size_bytes / 1024 as file_size_kb,
  start_time,
  end_time,
  duration_ms / 1000.0 as duration_seconds,
  sample_rate,
  sample_count,
  status,
  array_length(data_ranges, 1) as continuous_ranges,
  gap_info->>'total_gaps' as total_gaps,
  gap_info->>'gap_percentage' as gap_percentage,
  uploaded_at
FROM recordings
ORDER BY uploaded_at DESC
LIMIT 10;

-- ============================================
-- 2. Detailed gap analysis for each recording
-- ============================================
SELECT
  filename,
  sample_count,
  duration_ms / 1000.0 as duration_seconds,
  sample_rate,
  gap_info->>'total_gaps' as total_gaps,
  gap_info->>'largest_gap_ms' as largest_gap_ms,
  gap_info->>'total_gap_duration_ms' as total_gap_duration_ms,
  gap_info->>'gap_percentage' as gap_percentage,
  CASE
    WHEN (gap_info->>'gap_percentage')::numeric > 20 THEN '⚠️ High gaps'
    WHEN (gap_info->>'gap_percentage')::numeric > 5 THEN '⚡ Moderate gaps'
    ELSE '✅ Good quality'
  END as quality_rating
FROM recordings
WHERE file_type = 'vtx'
ORDER BY (gap_info->>'gap_percentage')::numeric DESC;

-- ============================================
-- 3. View data ranges for specific recording
-- ============================================
SELECT
  filename,
  data_ranges,
  array_length(data_ranges, 1) as number_of_continuous_segments,
  duration_ms,
  -- Calculate total data coverage from ranges
  -- Loop through each range [start, end] pair
  (
    SELECT SUM((data_ranges[i][2] - data_ranges[i][1]))
    FROM generate_series(1, array_length(data_ranges, 1)) as i
  ) as total_data_ms,
  -- Calculate coverage percentage
  (
    SELECT SUM((data_ranges[i][2] - data_ranges[i][1])::numeric)
    FROM generate_series(1, array_length(data_ranges, 1)) as i
  ) / NULLIF(duration_ms, 0) * 100 as data_coverage_percentage
FROM recordings
WHERE file_type = 'vtx'
ORDER BY uploaded_at DESC;

-- ============================================
-- 4. Gap details with human-readable times
-- ============================================
SELECT
  filename,
  gap->>'start_offset_ms' as gap_start_offset_ms,
  gap->>'end_offset_ms' as gap_end_offset_ms,
  gap->>'duration_ms' as gap_duration_ms,
  (gap->>'duration_ms')::numeric / 1000.0 as gap_duration_seconds,
  start_time + ((gap->>'start_offset_ms')::numeric || ' milliseconds')::interval as gap_start_absolute_time,
  start_time + ((gap->>'end_offset_ms')::numeric || ' milliseconds')::interval as gap_end_absolute_time
FROM recordings,
  jsonb_array_elements(gap_info->'gap_details') as gap
WHERE file_type = 'vtx'
  AND gap_info->'gap_details' IS NOT NULL
ORDER BY filename, (gap->>'start_offset_ms')::numeric;

-- ============================================
-- 5. Sample rate accuracy validation
-- ============================================
-- Compare declared sample rate vs actual sample density
SELECT
  filename,
  sample_rate as declared_sample_rate,
  sample_count,
  duration_ms / 1000.0 as duration_seconds,
  sample_count / (duration_ms / 1000.0) as calculated_sample_rate,
  ABS(sample_rate - (sample_count / (duration_ms / 1000.0))) as sample_rate_error,
  CASE
    WHEN ABS(sample_rate - (sample_count / (duration_ms / 1000.0))) < 1 THEN '✅ Accurate'
    WHEN ABS(sample_rate - (sample_count / (duration_ms / 1000.0))) < 5 THEN '⚠️ Slight variance'
    ELSE '❌ Significant variance'
  END as sample_rate_quality
FROM recordings
WHERE file_type = 'vtx'
  AND duration_ms > 0;

-- ============================================
-- 6. Storage usage by file type
-- ============================================
SELECT
  file_type,
  COUNT(*) as file_count,
  SUM(file_size_bytes) / 1024 / 1024 as total_size_mb,
  AVG(file_size_bytes) / 1024 as avg_size_kb,
  MIN(file_size_bytes) / 1024 as min_size_kb,
  MAX(file_size_bytes) / 1024 as max_size_kb
FROM recordings
GROUP BY file_type
ORDER BY file_type;

-- ============================================
-- 7. Data quality summary
-- ============================================
SELECT
  COUNT(*) as total_recordings,
  COUNT(CASE WHEN status = 'ready' THEN 1 END) as ready_count,
  COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing_count,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_count,
  AVG((gap_info->>'gap_percentage')::numeric) as avg_gap_percentage,
  AVG(sample_count) as avg_sample_count,
  AVG(duration_ms / 1000.0) as avg_duration_seconds
FROM recordings
WHERE file_type = 'vtx';

-- ============================================
-- 8. Find recordings with specific characteristics
-- ============================================

-- High quality recordings (< 5% gaps)
SELECT filename, gap_info->>'gap_percentage' as gap_pct
FROM recordings
WHERE (gap_info->>'gap_percentage')::numeric < 5
  AND file_type = 'vtx'
ORDER BY uploaded_at DESC;

-- Long duration recordings (> 5 minutes)
SELECT filename, duration_ms / 1000.0 / 60.0 as duration_minutes
FROM recordings
WHERE duration_ms > 300000
  AND file_type = 'vtx'
ORDER BY duration_ms DESC;

-- Recent uploads (last 24 hours)
SELECT filename, uploaded_at, status
FROM recordings
WHERE uploaded_at > NOW() - INTERVAL '24 hours'
ORDER BY uploaded_at DESC;

-- ============================================
-- 9. Device information summary
-- ============================================
SELECT
  device_info->>'id' as device_id,
  device_info->>'name' as device_name,
  device_info->>'firmware_version' as firmware_version,
  COUNT(*) as recording_count,
  MAX(uploaded_at) as last_upload
FROM recordings
WHERE device_info IS NOT NULL
  AND file_type = 'vtx'
GROUP BY device_info->>'id', device_info->>'name', device_info->>'firmware_version'
ORDER BY recording_count DESC;

-- ============================================
-- 10. Verify RLS policies are working
-- ============================================
-- This should return only recordings for the current user
SELECT
  COUNT(*) as my_recording_count,
  user_id
FROM recordings
GROUP BY user_id;

-- ============================================
-- 11. Check for orphaned storage files
-- ============================================
-- Note: Run this in Supabase SQL Editor with proper permissions
-- This checks if all recordings have valid storage paths
SELECT
  id,
  filename,
  storage_path,
  status,
  CASE
    WHEN storage_path IS NULL THEN '❌ Missing storage path'
    WHEN storage_path = '' THEN '❌ Empty storage path'
    ELSE '✅ Has storage path'
  END as storage_status
FROM recordings
ORDER BY uploaded_at DESC;

-- ============================================
-- 12. Gap distribution histogram
-- ============================================
-- Shows how gaps are distributed across recordings
SELECT
  CASE
    WHEN (gap_info->>'gap_percentage')::numeric = 0 THEN '0% (Perfect)'
    WHEN (gap_info->>'gap_percentage')::numeric <= 1 THEN '0-1% (Excellent)'
    WHEN (gap_info->>'gap_percentage')::numeric <= 5 THEN '1-5% (Good)'
    WHEN (gap_info->>'gap_percentage')::numeric <= 10 THEN '5-10% (Fair)'
    WHEN (gap_info->>'gap_percentage')::numeric <= 20 THEN '10-20% (Poor)'
    ELSE '>20% (Very Poor)'
  END as gap_range,
  COUNT(*) as recording_count,
  ROUND(AVG((gap_info->>'gap_percentage')::numeric), 2) as avg_gap_pct
FROM recordings
WHERE file_type = 'vtx'
  AND gap_info IS NOT NULL
GROUP BY gap_range
ORDER BY
  CASE gap_range
    WHEN '0% (Perfect)' THEN 1
    WHEN '0-1% (Excellent)' THEN 2
    WHEN '1-5% (Good)' THEN 3
    WHEN '5-10% (Fair)' THEN 4
    WHEN '10-20% (Poor)' THEN 5
    ELSE 6
  END;
