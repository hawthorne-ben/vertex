-- Vertex Pipeline Validation Queries
-- Run these queries in your Supabase SQL editor to validate the upload and processing pipeline

-- 1. RECENT UPLOADS OVERVIEW
-- Check recent file uploads and their processing status
SELECT 
    id,
    filename,
    file_size_bytes,
    status,
    uploaded_at,
    parsed_at,
    sample_count,
    sample_rate,
    error_message,
    EXTRACT(EPOCH FROM (parsed_at - uploaded_at)) as processing_time_seconds
FROM imu_data_files 
ORDER BY uploaded_at DESC 
LIMIT 10;

-- 2. PROCESSING STATUS BREAKDOWN
-- Get a count of files by processing status
SELECT 
    status,
    COUNT(*) as file_count,
    AVG(file_size_bytes) as avg_file_size_bytes,
    AVG(sample_count) as avg_sample_count
FROM imu_data_files 
GROUP BY status
ORDER BY file_count DESC;

-- 3. RECENT SUCCESSFUL PROCESSING
-- Check files that were successfully processed in the last hour
SELECT 
    id,
    filename,
    file_size_bytes,
    sample_count,
    sample_rate,
    uploaded_at,
    parsed_at,
    EXTRACT(EPOCH FROM (parsed_at - uploaded_at)) as processing_time_seconds
FROM imu_data_files 
WHERE status = 'ready' 
    AND parsed_at >= NOW() - INTERVAL '1 hour'
ORDER BY parsed_at DESC;

-- 4. RECENT ERRORS
-- Check files that failed processing in the last hour
SELECT 
    id,
    filename,
    file_size_bytes,
    error_message,
    uploaded_at,
    parsed_at
FROM imu_data_files 
WHERE status = 'error' 
    AND parsed_at >= NOW() - INTERVAL '1 hour'
ORDER BY parsed_at DESC;

-- 5. SAMPLE DATA VALIDATION
-- Check if samples were properly inserted for recent files
SELECT 
    f.id as file_id,
    f.filename,
    f.sample_count as expected_samples,
    COUNT(s.id) as actual_samples,
    f.sample_count - COUNT(s.id) as missing_samples,
    MIN(s.timestamp) as first_sample_time,
    MAX(s.timestamp) as last_sample_time
FROM imu_data_files f
LEFT JOIN imu_samples s ON f.id = s.imu_file_id
WHERE f.status = 'ready' 
    AND f.parsed_at >= NOW() - INTERVAL '1 hour'
GROUP BY f.id, f.filename, f.sample_count
ORDER BY f.parsed_at DESC;

-- 6. PROCESSING PERFORMANCE ANALYSIS
-- Analyze processing times for different file sizes
SELECT 
    CASE 
        WHEN file_size_bytes < 100000 THEN '< 100KB'
        WHEN file_size_bytes < 500000 THEN '100KB - 500KB'
        WHEN file_size_bytes < 1000000 THEN '500KB - 1MB'
        WHEN file_size_bytes < 5000000 THEN '1MB - 5MB'
        ELSE '> 5MB'
    END as file_size_range,
    COUNT(*) as file_count,
    AVG(sample_count) as avg_samples,
    AVG(EXTRACT(EPOCH FROM (parsed_at - uploaded_at))) as avg_processing_time_seconds,
    MIN(EXTRACT(EPOCH FROM (parsed_at - uploaded_at))) as min_processing_time_seconds,
    MAX(EXTRACT(EPOCH FROM (parsed_at - uploaded_at))) as max_processing_time_seconds
FROM imu_data_files 
WHERE status = 'ready' 
    AND parsed_at IS NOT NULL
GROUP BY file_size_range
ORDER BY avg_processing_time_seconds;

-- 7. USER ACTIVITY SUMMARY
-- Check upload activity by user
SELECT 
    user_id,
    COUNT(*) as total_files,
    COUNT(CASE WHEN status = 'ready' THEN 1 END) as successful_files,
    COUNT(CASE WHEN status = 'error' THEN 1 END) as failed_files,
    COUNT(CASE WHEN status = 'parsing' THEN 1 END) as processing_files,
    COUNT(CASE WHEN status = 'uploaded' THEN 1 END) as pending_files,
    SUM(file_size_bytes) as total_bytes_uploaded,
    AVG(file_size_bytes) as avg_file_size_bytes,
    MAX(uploaded_at) as last_upload
FROM imu_data_files 
WHERE uploaded_at >= NOW() - INTERVAL '24 hours'
GROUP BY user_id
ORDER BY total_files DESC;

-- 8. DATA QUALITY CHECK
-- Validate sample data integrity
SELECT 
    f.id as file_id,
    f.filename,
    COUNT(s.id) as total_samples,
    COUNT(CASE WHEN s.accel_x IS NOT NULL THEN 1 END) as accel_x_samples,
    COUNT(CASE WHEN s.accel_y IS NOT NULL THEN 1 END) as accel_y_samples,
    COUNT(CASE WHEN s.accel_z IS NOT NULL THEN 1 END) as accel_z_samples,
    COUNT(CASE WHEN s.gyro_x IS NOT NULL THEN 1 END) as gyro_x_samples,
    COUNT(CASE WHEN s.gyro_y IS NOT NULL THEN 1 END) as gyro_y_samples,
    COUNT(CASE WHEN s.gyro_z IS NOT NULL THEN 1 END) as gyro_z_samples,
    COUNT(CASE WHEN s.mag_x IS NOT NULL THEN 1 END) as mag_x_samples,
    COUNT(CASE WHEN s.mag_y IS NOT NULL THEN 1 END) as mag_y_samples,
    COUNT(CASE WHEN s.mag_z IS NOT NULL THEN 1 END) as mag_z_samples,
    AVG(s.accel_x) as avg_accel_x,
    AVG(s.accel_y) as avg_accel_y,
    AVG(s.accel_z) as avg_accel_z
FROM imu_data_files f
JOIN imu_samples s ON f.id = s.imu_file_id
WHERE f.status = 'ready' 
    AND f.parsed_at >= NOW() - INTERVAL '1 hour'
GROUP BY f.id, f.filename
ORDER BY f.parsed_at DESC;

-- 9. STUCK PROCESSING CHECK
-- Find files that have been processing for too long
SELECT 
    id,
    filename,
    file_size_bytes,
    uploaded_at,
    parsed_at,
    EXTRACT(EPOCH FROM (NOW() - uploaded_at)) as time_since_upload_seconds,
    EXTRACT(EPOCH FROM (NOW() - COALESCE(parsed_at, uploaded_at))) as time_in_current_status_seconds
FROM imu_data_files 
WHERE status IN ('uploaded', 'parsing')
    AND uploaded_at < NOW() - INTERVAL '10 minutes'
ORDER BY uploaded_at ASC;

-- 10. BATCH INSERT VALIDATION
-- Check if samples were inserted in proper batches (should be multiples of 10000)
SELECT 
    f.id as file_id,
    f.filename,
    f.sample_count,
    COUNT(s.id) as actual_samples,
    MOD(COUNT(s.id), 10000) as remainder_from_batch_size,
    CASE 
        WHEN MOD(COUNT(s.id), 10000) = 0 OR COUNT(s.id) = f.sample_count THEN 'OK'
        ELSE 'BATCH_SIZE_ISSUE'
    END as batch_status
FROM imu_data_files f
JOIN imu_samples s ON f.id = s.imu_file_id
WHERE f.status = 'ready' 
    AND f.parsed_at >= NOW() - INTERVAL '1 hour'
GROUP BY f.id, f.filename, f.sample_count
ORDER BY f.parsed_at DESC;

-- 11. QUICK HEALTH CHECK
-- One-liner to check overall system health
SELECT 
    'System Health Check' as check_type,
    COUNT(*) as total_files,
    COUNT(CASE WHEN status = 'ready' THEN 1 END) as ready_files,
    COUNT(CASE WHEN status = 'error' THEN 1 END) as error_files,
    COUNT(CASE WHEN status IN ('uploaded', 'parsing') THEN 1 END) as processing_files,
    ROUND(COUNT(CASE WHEN status = 'ready' THEN 1 END) * 100.0 / COUNT(*), 2) as success_rate_percent,
    MAX(uploaded_at) as last_upload_time,
    MAX(parsed_at) as last_processing_time
FROM imu_data_files 
WHERE uploaded_at >= NOW() - INTERVAL '24 hours';
