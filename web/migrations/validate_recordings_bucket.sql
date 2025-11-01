-- Validate recordings bucket and policies
-- Run this in Supabase SQL Editor to check configuration

-- 1. Check if recordings bucket exists
SELECT
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types,
  created_at
FROM storage.buckets
WHERE id = 'recordings';

-- Expected: One row with id='recordings', public=false, file_size_limit=524288000

-- 2. Check storage policies for recordings bucket
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'storage'
  AND tablename = 'objects'
  AND policyname LIKE '%recording%'
ORDER BY policyname;

-- Expected: 5 policies for recordings bucket operations

-- 3. Test user path format - check if storage.foldername works
-- Replace 'test-user-uuid' with your actual user_id
SELECT
  (storage.foldername('92f55ed1-bdb9-42cb-9008-621f1a500b5e/1761939188358_Built.vtx'))[1] as extracted_user_id;

-- Expected: Returns '92f55ed1-bdb9-42cb-9008-621f1a500b5e'

-- 4. Check if any objects exist in recordings bucket
SELECT
  name,
  bucket_id,
  owner,
  created_at,
  metadata->>'size' as size_bytes
FROM storage.objects
WHERE bucket_id = 'recordings'
ORDER BY created_at DESC
LIMIT 10;

-- Shows recent uploads to recordings bucket

-- 5. Check current user's auth status (run this when logged in as the user)
SELECT
  auth.uid() as current_user_id,
  auth.role() as current_role;

-- Expected: Returns your user_id when authenticated
