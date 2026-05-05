-- ========================================
-- CLEANUP SCRIPT: Delete All Ride Associations
-- ========================================
-- WARNING: This will delete all ride-recording associations
-- and trigger re-merge of VTX files when re-associated
--
-- Use this when:
-- - Testing VTX merge functionality
-- - Resetting ride data after schema changes
-- - Clearing test data
--
-- Does NOT delete:
-- - Rides table entries
-- - Recordings table entries
-- - Uploaded VTX/FIT files in storage
--
-- Does delete:
-- - ride_recordings junction table entries
-- - Merged VTX files from storage (rides/{id}/merged.vtx)
-- - merged_vtx_path references in rides table
-- ========================================

BEGIN;

-- Step 1: Get list of merged VTX files to delete from storage
-- (You'll need to delete these manually or via a script)
SELECT
  id as ride_id,
  merged_vtx_path,
  merged_vtx_file_size_bytes,
  merged_at
FROM rides
WHERE merged_vtx_path IS NOT NULL
ORDER BY merged_at DESC;

-- Step 2: Clear merged VTX file references in rides table
UPDATE rides
SET
  merged_vtx_path = NULL,
  merged_vtx_file_size_bytes = NULL,
  merged_at = NULL
WHERE merged_vtx_path IS NOT NULL;

-- Step 3: Delete all ride-recording associations
DELETE FROM ride_recordings;

-- Step 4: Verify cleanup
SELECT
  (SELECT COUNT(*) FROM ride_recordings) as remaining_associations,
  (SELECT COUNT(*) FROM rides WHERE merged_vtx_path IS NOT NULL) as remaining_merged_refs;

COMMIT;

-- ========================================
-- STORAGE CLEANUP (Manual Step)
-- ========================================
-- After running this SQL, you need to delete merged VTX files from storage.
-- Run this query to get the list of files to delete:
--
-- SELECT DISTINCT merged_vtx_path
-- FROM rides
-- WHERE merged_vtx_path IS NOT NULL;
--
-- Then delete from Supabase Storage:
-- 1. Go to Supabase Dashboard → Storage → recordings bucket
-- 2. Navigate to rides/{ride_id}/ directories
-- 3. Delete merged.vtx files
--
-- OR use Supabase CLI:
-- supabase storage rm recordings/rides/{ride_id}/merged.vtx
-- ========================================
