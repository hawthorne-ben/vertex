# Storage Cleanup Policy

## Overview

CSV files are automatically deleted from Supabase Storage **30 days after successful parsing**. This balances storage costs with the ability to re-process files if issues are discovered.

## What Gets Deleted

- ✅ Raw CSV files in Supabase Storage
- ✅ Chunked file parts (if chunked upload was used)
- ❌ Database records (kept forever for querying)
- ❌ Parsed IMU samples (kept forever for analysis)

## Retention Policy

| File Status | Storage Retention | Database Retention |
|-------------|------------------|-------------------|
| **Uploaded** | Until parsed or failed | Forever |
| **Parsing** | Until success/failure | Forever |
| **Ready** | 30 days after parse | Forever |
| **Failed** | Forever (manual cleanup) | Forever |

## Automatic Cleanup

**Cron Job**: Runs daily at 2 AM (server time)
- **Function**: `cleanup-old-storage`
- **Schedule**: `0 2 * * *` (2 AM daily)
- **Action**: Deletes storage files for files with `status = 'ready'` and `parsed_at > 30 days ago`

## Manual Cleanup

### Trigger Cleanup On-Demand

```bash
# Via API
curl -X POST http://localhost:3000/api/admin/cleanup-storage

# Or in browser console
fetch('/api/admin/cleanup-storage', { method: 'POST' })
  .then(r => r.json())
  .then(console.log)
```

### Check What Will Be Cleaned

```sql
-- Files ready for cleanup (30+ days old)
SELECT 
  id,
  filename,
  parsed_at,
  file_size_bytes / 1024 / 1024 as size_mb,
  AGE(NOW(), parsed_at) as age
FROM imu_data_files
WHERE status = 'ready'
  AND storage_path IS NOT NULL
  AND parsed_at < NOW() - INTERVAL '30 days'
ORDER BY parsed_at ASC;
```

### Storage Usage Report

```sql
-- Total storage usage by status
SELECT 
  status,
  COUNT(*) as file_count,
  SUM(file_size_bytes) / 1024 / 1024 as total_mb,
  AVG(file_size_bytes) / 1024 / 1024 as avg_mb
FROM imu_data_files
WHERE storage_path IS NOT NULL
GROUP BY status;
```

## Storage Cost Estimates

**Supabase Storage Pricing**:
- Free tier: 1 GB
- Pro tier: 100 GB included, $0.021/GB/month after

**Example Usage**:
- Upload rate: 12 files/month × 50MB = 600MB/month
- With 30-day retention: ~600MB steady-state storage
- **Fits in free tier** ✅

Without cleanup:
- After 1 year: ~7.2GB (need Pro tier)
- After 2 years: ~14.4GB
- Cost: ~$0.30-0.60/month

## Monitoring

### Inngest Dashboard

View cleanup job runs:
- **Dev**: http://localhost:8288
- **Prod**: https://app.inngest.com

### Check Last Cleanup

```sql
-- Check when cleanup last ran (requires logging table - future enhancement)
SELECT MAX(parsed_at) as oldest_file_with_storage
FROM imu_data_files
WHERE status = 'ready' AND storage_path IS NOT NULL;
```

## Re-Processing Files

If you need to re-process a file:

**Within 30 days**: Just trigger the parse job again
```bash
# The storage file still exists
curl -X POST /api/admin/retry-stuck-uploads
```

**After 30 days**: You'll need to re-upload the file
- Storage file is deleted
- Database metadata remains (for reference)
- Upload the CSV again to re-process

## Failed Files

Files with `status = 'failed'` are **NOT automatically cleaned** up. This allows debugging.

To clean up failed files manually:
```sql
-- Find failed files
SELECT id, filename, error_message, uploaded_at
FROM imu_data_files
WHERE status = 'failed'
ORDER BY uploaded_at DESC;

-- Delete a failed file (via UI or API)
-- This will remove storage + database records
```

## Disable Cleanup (Not Recommended)

If you want to keep all storage files forever:

1. Remove the cron schedule from `cleanup-old-storage.ts`:
   ```typescript
   // Change from:
   { cron: '0 2 * * *' }
   // To:
   { event: 'storage/cleanup' } // Manual trigger only
   ```

2. Redeploy the app

**Warning**: Storage costs will grow indefinitely (~7GB/year for typical usage).

## Future Enhancements

- [ ] Configurable retention period (7, 30, 90 days)
- [ ] Storage usage dashboard in UI
- [ ] Email notifications when storage quota is low
- [ ] Compress old files before deletion (keep compressed backup)
- [ ] Export to S3 Glacier for long-term archival

---

**Last Updated**: October 23, 2025

