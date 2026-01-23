# IMU Data Storage Architecture

## Current Implementation

### Storage Strategy
IMU sensor data is **stored as binary VTX files** in Supabase Storage, not in database tables.

**Why?**
- High-frequency sensor data (25Hz) generates millions of rows per ride
- Binary storage is more efficient than database rows for time-series data
- Parsing on-demand keeps database lean and fast
- Enables efficient streaming and partial reads

### Schema

**`recordings` table** (metadata only):
```sql
CREATE TABLE recordings (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES auth.users,
  filename TEXT,
  file_type TEXT CHECK (file_type IN ('vtx', 'fit')),
  storage_path TEXT UNIQUE,  -- Path to binary file in Supabase Storage
  start_time TIMESTAMPTZ,
  end_time TIMESTAMPTZ,
  sample_count BIGINT,
  status TEXT CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  ...
)
```

**Binary files in Storage**:
- Bucket: `recordings`
- Format: VTX (custom binary format via `@vertex-pkg/vtx-parser`)
- Access: Downloaded and parsed on-demand by API routes

### Data Access Pattern

When API endpoints need IMU data:

1. Query `recordings` table for metadata
2. Download binary VTX file from storage using `storage_path`
3. Parse using `VTXDecoder` from `@vertex-pkg/vtx-parser`
4. Extract needed fields (accel, gyro, euler, etc.)
5. Apply filtering/downsampling if needed
6. Return to client

**Example** (from `/api/rides/[id]/pedaling-efficiency`):
```typescript
// Get metadata
const { data: recording } = await supabase
  .from('recordings')
  .select('storage_path')
  .eq('id', recordingId)
  .single()

// Download binary file
const { data: fileData } = await supabase.storage
  .from('recordings')
  .download(recording.storage_path)

// Parse VTX
const decoder = new VTXDecoder(arrayBuffer)
for (let i = 0; i < recordCount; i++) {
  const record = decoder.readRecord(i)
  // Use record.accelX, record.gyroX, etc.
}
```

## Future Consideration: `imu_events` Table

**Note**: You may encounter references to an `imu_events` table in Supabase error messages or older discussions. **This table does not exist and is not used.**

A database table for IMU samples was considered but **not implemented** because:
- At 25Hz, a 1-hour ride = 90,000 rows per recording
- Database queries would be slower than binary parsing
- Storage costs would be higher
- No benefit over on-demand parsing for our access patterns

If we need faster random access to specific time ranges in the future, we could:
1. Add `imu_events` table for indexed lookups
2. Populate on file upload (batch insert during processing)
3. Keep binary files as backup/source of truth

But for now, **binary files + on-demand parsing is the correct approach**.

## Related Files
- `/api/recordings/[id]/samples/route.ts` - VTX parsing example
- `/api/rides/[id]/pedaling-efficiency/route.ts` - Multi-file VTX parsing
- `@vertex-pkg/vtx-parser` - Binary format decoder
