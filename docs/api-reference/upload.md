---
layout: default
title: Data Upload API
description: File upload endpoints and chunked upload API for Vertex platform
---

# Data Upload API

## Overview

The upload API handles large file uploads (30-150MB) using a chunked upload strategy for reliability and progress tracking.

---

## Endpoints

### POST `/api/upload/chunk-url`

Initiates a chunked upload session.

**Request:**
```json
{
  "filename": "ride_data.csv",
  "fileSize": 52428800,
  "fileType": "imu_csv",
  "chunkSize": 1048576
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "uploadId": "uuid-upload-id",
    "chunkUrls": [
      "https://storage.supabase.co/object/upload/chunk-1",
      "https://storage.supabase.co/object/upload/chunk-2"
    ],
    "totalChunks": 50
  }
}
```

### POST `/api/upload/complete-chunked`

Completes a chunked upload and triggers processing.

**Request:**
```json
{
  "uploadId": "uuid-upload-id",
  "filename": "ride_data.csv",
  "fileType": "imu_csv"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "fileId": "uuid-file-id",
    "status": "processing",
    "message": "Upload completed, processing started"
  }
}
```

---

## File Types

### IMU CSV Files
- **Format**: CSV with headers
- **Required Columns**: timestamp, accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z
- **Optional Columns**: mag_x, mag_y, mag_z, temperature
- **Size Limit**: 500MB
- **Sample Rate**: 50-100Hz

### FIT Files
- **Format**: Binary FIT file
- **Content**: GPS track, power, heart rate, cadence
- **Size Limit**: 50MB
- **Compatibility**: Garmin, Wahoo, other cycling computers

---

## Upload Flow

1. **Initiate Upload**: Call `/chunk-url` to get chunk URLs
2. **Upload Chunks**: Upload file in 1MB chunks to provided URLs
3. **Complete Upload**: Call `/complete-chunked` to finalize
4. **Background Processing**: Inngest job processes the file
5. **Status Updates**: Poll file status or use real-time updates

---

## Error Handling

### Common Errors

**File Too Large**
```json
{
  "success": false,
  "error": "File size exceeds maximum limit",
  "code": "FILE_TOO_LARGE"
}
```

**Invalid File Type**
```json
{
  "success": false,
  "error": "Unsupported file type",
  "code": "INVALID_FILE_TYPE"
}
```

**Upload Failed**
```json
{
  "success": false,
  "error": "Upload failed, please retry",
  "code": "UPLOAD_FAILED"
}
```

---

## Progress Tracking

### File Status Values
- `uploading`: Chunks being uploaded
- `processing`: Background job processing data
- `completed`: File processed successfully
- `failed`: Processing failed

### Real-time Updates
Use Supabase real-time subscriptions to track upload progress:

```javascript
const subscription = supabase
  .channel('file-status')
  .on('postgres_changes', {
    event: 'UPDATE',
    schema: 'public',
    table: 'data_files',
    filter: `id=eq.${fileId}`
  }, (payload) => {
    console.log('Status update:', payload.new.upload_status);
  })
  .subscribe();
```

---

## Related Documentation

- [Development Guide]({{ site.baseurl }}/development/) - Setup and deployment procedures
