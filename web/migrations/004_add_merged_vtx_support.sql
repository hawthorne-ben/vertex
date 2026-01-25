-- Migration: Add support for merged VTX files per ride
-- Date: 2026-01-25
-- RFC: 003-ride-data-api-optimization Phase 2a

-- Add columns to rides table for merged VTX file tracking
ALTER TABLE rides
ADD COLUMN merged_vtx_path TEXT NULL,
ADD COLUMN merged_vtx_file_size_bytes BIGINT NULL,
ADD COLUMN merged_at TIMESTAMP WITH TIME ZONE NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN rides.merged_vtx_path IS 'Storage path to merged VTX file (combines all ride_recordings VTX files)';
COMMENT ON COLUMN rides.merged_vtx_file_size_bytes IS 'Size of merged VTX file in bytes';
COMMENT ON COLUMN rides.merged_at IS 'Timestamp when VTX files were merged';

-- Create index for queries that filter by merged files
CREATE INDEX idx_rides_merged_vtx_path ON rides(merged_vtx_path) WHERE merged_vtx_path IS NOT NULL;

-- Create index for cleanup queries (find old merged files)
CREATE INDEX idx_rides_merged_at ON rides(merged_at) WHERE merged_at IS NOT NULL;

-- Note: Merged files are stored in storage bucket at path: rides/{ride_id}/merged.vtx
-- Original VTX recordings in ride_recordings junction table remain unchanged
-- This allows rollback by clearing merged_vtx_path column
