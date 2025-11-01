-- Create uploads bucket for temporary chunk storage
-- Run this in Supabase SQL Editor

-- Create uploads bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('uploads', 'uploads', false, 524288000, NULL) -- 500MB limit, matches recordings
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 524288000;

-- Create storage policies for uploads bucket (temporary storage for chunks)
DROP POLICY IF EXISTS "Users can upload chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can read their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete their own chunks" ON storage.objects;
DROP POLICY IF EXISTS "Service role can manage all uploads" ON storage.objects;

CREATE POLICY "Users can upload chunks"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Users can read their own chunks"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'uploads'
  AND (
    auth.uid()::text = (storage.foldername(name))[1]
    OR name LIKE 'chunks/%'  -- Allow reading from chunks folder
  )
);

CREATE POLICY "Users can delete their own chunks"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'uploads'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Service role can access all uploads (for processing chunks)
CREATE POLICY "Service role can manage all uploads"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- Verify bucket was created
SELECT
  id,
  name,
  public,
  file_size_limit
FROM storage.buckets
WHERE id IN ('recordings', 'uploads')
ORDER BY name;
