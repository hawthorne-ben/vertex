# Database Schema Migration Plan

## Overview

This document explains the unified database schema migration strategy that consolidates the VTX migration (001) with the complete database schema and removes all legacy tables.

## Current State

### Migration Files
1. **001_vtx_migration.sql** - Creates `recordings` and `recording_analysis` tables, drops `imu_samples` and `imu_data_files`
2. **002_unified_schema.sql** - Complete unified schema with all tables, indexes, policies, and storage configuration

### Tables in Codebase

**New Schema (VTX Migration):**
- ✅ `recordings` - Unified storage for VTX and FIT files
- ✅ `recording_analysis` - Analysis results for recordings
- 🔄 `rides` - User-created rides
- 🔄 `ride_recordings` - Association between rides and recordings

**Legacy Tables (to be removed):**
- ❌ `imu_samples` - Old CSV-based sample storage
- ❌ `imu_data_files` - Old IMU file metadata
- ❌ `fit_files` - Old FIT file metadata
- ❌ `data_files` - Old generic file metadata
- ❌ `ride_data_files` - Old ride-file associations
- ❌ `association_history` - Old association audit trail

## Migration Strategy

### Option 1: Sequential Migrations (Current)
Run migrations in order: 001, then 002
- ✅ Preserves migration history
- ❌ Some redundancy between migrations
- ❌ 001 drops tables that may not exist yet

### Option 2: Consolidated Migration (Recommended)
Update 001 to be minimal, rely on 002 for complete setup
- ✅ Single source of truth (002)
- ✅ Cleaner migration history
- ❌ Requires updating existing 001 migration

### Option 3: Fresh Start
Combine into single 001 migration
- ✅ Simplest approach for new deployments
- ❌ Loses historical context of incremental changes

## Recommended Approach: Option 2

### Step 1: Simplify 001_vtx_migration.sql

Remove redundant sections from 001 since 002 handles everything:

**Remove:**
- Storage bucket configuration (moved to 002)
- Most indexes (moved to 002)
- Detailed RLS policies (moved to 002)
- Helper functions (moved to 002)
- Triggers (moved to 002)

**Keep:**
- DROP TABLE statements for legacy tables
- Basic recordings table structure
- Comment explaining VTX migration purpose

### Step 2: Use 002_unified_schema.sql as Complete Schema

The 002 migration should be the single source of truth with:
- All table definitions
- All indexes
- All storage configuration
- All RLS policies
- All helper functions and triggers
- All legacy table cleanup

### Step 3: Update Application Code

After running 002, update code references:
- Replace `imu_data_files` → `recordings` WHERE `file_type = 'vtx'`
- Replace `fit_files` → `recordings` WHERE `file_type = 'fit'`
- Replace `ride_data_files` → `ride_recordings`
- Update association logic to use new schema

## Idempotency Guarantees

All migrations use:
- `CREATE TABLE IF NOT EXISTS` for tables
- `CREATE INDEX IF NOT EXISTS` for indexes
- `DROP POLICY IF EXISTS ... CREATE POLICY` for RLS policies
- `DROP FUNCTION IF EXISTS ... CREATE OR REPLACE FUNCTION` for functions
- `DROP TRIGGER IF EXISTS` for triggers
- `INSERT ... ON CONFLICT DO UPDATE` for bucket configuration

This ensures migrations can be run multiple times safely.

## Migration Order

1. **001_vtx_migration.sql** - Legacy cleanup, basic recordings table
2. **002_unified_schema.sql** - Complete schema setup
3. **create_uploads_bucket.sql** - (Redundant, now in 002)
4. **validate_recordings_bucket.sql** - Validation queries only

## Testing Strategy

### Before Migration
```sql
-- Check what tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('recordings', 'imu_samples', 'imu_data_files', 
                     'fit_files', 'data_files', 'rides', 'ride_recordings');
```

### After Migration
```sql
-- Verify new tables exist
SELECT 'recordings', COUNT(*) FROM recordings
UNION ALL
SELECT 'recording_analysis', COUNT(*) FROM recording_analysis
UNION ALL
SELECT 'rides', COUNT(*) FROM rides
UNION ALL
SELECT 'ride_recordings', COUNT(*) FROM ride_recordings;

-- Verify legacy tables are gone
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('imu_samples', 'imu_data_files', 
                     'fit_files', 'data_files', 'ride_data_files')
ORDER BY table_name;
```

### Check Indexes
```sql
-- Verify key indexes exist
SELECT indexname, tablename 
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND tablename IN ('recordings', 'recording_analysis', 'rides', 'ride_recordings')
ORDER BY tablename, indexname;
```

### Check RLS
```sql
-- Verify RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename IN ('recordings', 'recording_analysis', 'rides', 'ride_recordings');
```

### Check Policies
```sql
-- List all policies
SELECT schemaname, tablename, policyname 
FROM pg_policies 
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;
```

## Rollback Strategy

If migration fails or needs rollback:

1. **Drop new tables:**
```sql
DROP TABLE IF EXISTS ride_recordings CASCADE;
DROP TABLE IF EXISTS recording_analysis CASCADE;
DROP TABLE IF EXISTS rides CASCADE;
DROP TABLE IF EXISTS recordings CASCADE;
```

2. **Restore legacy tables** (only if you have backups)
3. **Run application in maintenance mode** to prevent new data

## Application Code Updates Required

### High Priority
1. `web/src/app/rides/page.tsx` - Currently uses `imu_data_files` and `fit_files`
2. `web/src/components/data-files-list.tsx` - References `imu_data_files`
3. `web/src/inngest/functions/cleanup-old-storage.ts` - References `imu_data_files`
4. `web/src/inngest/functions/parse-fit.ts` - References `fit_files`

### Medium Priority
1. `web/src/app/api/rides/*` - Need to check for legacy table references
2. `web/src/components/fit-files-list.tsx` - May reference `fit_files`

### Low Priority
1. Documentation updates in `docs/architecture/database.md`
2. Migration plan docs

## Migration Execution Plan

1. ✅ Create 002_unified_schema.sql
2. 🔄 Update 001_vtx_migration.sql to be minimal
3. ⏳ Test migrations on development database
4. ⏳ Update application code references
5. ⏳ Deploy to staging for full integration testing
6. ⏳ Schedule production deployment with rollback plan
7. ⏳ Monitor for 48 hours post-deployment

## Key Differences: Old vs New Schema

### File Storage
**Old:**
- `imu_data_files` for IMU files
- `fit_files` for FIT files
- Separate tables for different file types

**New:**
- `recordings` unified table with `file_type` column
- Single storage bucket for all recording types
- Consistent metadata structure

### Sample Data
**Old:**
- `imu_samples` table with individual sensor samples
- Millions of rows per file
- Slow queries, high storage costs

**New:**
- Binary VTX files stored in Supabase Storage
- No database rows for samples
- Fast file-based access

### Rides
**Old:**
- `rides` + `ride_data_files` + `data_files`
- Three-table join required

**New:**
- `rides` + `ride_recordings` → `recordings`
- Simpler two-table join
- Direct relationship model

### Association
**Old:**
- `association_history` audit table
- Columns on both `imu_data_files` and `fit_files`

**New:**
- `ride_recordings` junction table
- Clean separation of concerns
- Better query performance

## Performance Improvements

1. **Storage:** Reduced database size by ~95% (no individual samples)
2. **Queries:** Faster file listings (single table scan vs multiple)
3. **Indexes:** Better index coverage with GIN indexes on JSONB
4. **RLS:** Consistent policy structure across all tables
5. **Scalability:** Binary file storage handles large datasets efficiently

## Security Improvements

1. **Unified RLS policies** across all tables
2. **Consistent user isolation** pattern
3. **Storage bucket security** with proper folder permissions
4. **Service role access** only where needed
5. **Audit trail** through `recording_analysis` table

## Next Steps

1. Review this plan with team
2. Get approval for schema changes
3. Create backup of production database
4. Execute migrations in order: 001, then 002
5. Update application code incrementally
6. Monitor performance and errors
7. Update documentation

## Questions to Resolve

1. Do we have existing data in legacy tables that needs migration?
2. What's the downtime window for production deployment?
3. Should we keep 001_vtx_migration.sql as-is or simplify it?
4. Do we need a data migration script for existing records?
5. Should we create a `003_migrate_legacy_data.sql` migration?

