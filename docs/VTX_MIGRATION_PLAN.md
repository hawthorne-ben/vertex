# VTX Migration Plan - Web App Architecture Redesign

**Date:** 2025-10-30
**Status:** Proposed
**Author:** Claude + Ben

## Executive Summary

Migrate web app from CSV-based sample storage (PostgreSQL) to VTX binary format (Supabase Storage). This eliminates database bloat, enables efficient post-processing, and provides O(1) timestamp indexing for complex analysis.

## Problem Statement

### Current Architecture Issues
1. **Database Bloat**: 10 min @ 100Hz = 60,000 rows. 2-hour ride = 720,000 rows
2. **Query Overhead**: Multiple queries needed even with LTTB downsampling
3. **Processing Bottleneck**: CSV parsing → 10k batch inserts is slow
4. **Storage Costs**: PostgreSQL storage expensive vs object storage
5. **Limited Post-Processing**: Complex algorithms require fetching massive datasets

### VTX Format Advantages
1. **60-70% size reduction** vs CSV
2. **O(1) timestamp indexing** - instant access to any time range
3. **Self-contained** - metadata, calibration, session info embedded
4. **Fast binary parsing** - 5-10x faster than CSV
5. **Perfect for complex analysis** - load once, process in memory, write results
6. **Scalable** - GB-scale files don't stress database

## Solution Architecture

### High-Level Design

```
┌─────────────────────────────────────────────────────────────┐
│                      Upload Pipeline                         │
├─────────────────────────────────────────────────────────────┤
│  User uploads: .vtx or .fit                                 │
│  ↓                                                           │
│  Supabase Storage (bucket: 'recordings')                    │
│  - Path: {user_id}/{file_id}.{vtx|fit}                     │
│  ↓                                                           │
│  Fast Header Parse (64 bytes for VTX)                       │
│  - Extract metadata, time ranges, gap detection             │
│  ↓                                                           │
│  Database: Store metadata only (not samples)                │
│  - File reference, time ranges, gaps, device info           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                   Database Schema (Lean)                     │
├─────────────────────────────────────────────────────────────┤
│  recordings:                                                 │
│  - id, user_id, filename                                    │
│  - file_type: 'vtx' | 'fit'                                │
│  - storage_path, file_size_bytes                           │
│  - start_time, end_time, duration_ms                       │
│  - data_ranges: Array of [start, end] timestamps           │
│  - gap_info: {total_gaps, largest_gap_ms, gap_percentage}  │
│  - sample_rate, sample_count                               │
│  - device_info (JSON)                                      │
│  - session_metadata (JSON: bike, position, tags)           │
│  - analysis_results (JSON: computed metrics)               │
│  - status: 'uploaded' | 'processing' | 'ready' | 'failed' │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Visualization Pipeline                    │
├─────────────────────────────────────────────────────────────┤
│  API Route: /api/data/[id]/samples                         │
│  ↓                                                           │
│  1. Fetch file metadata from DB (includes gap info)        │
│  2. Get storage URL (presigned, 1hr expiry)                │
│  3. Stream file from storage:                              │
│     - VTX: Use VTXDecoder (read header, seek to range)    │
│     - FIT: Use FIT decoder (parse subset)                 │
│  4. Apply LTTB downsampling in-memory                      │
│  5. Return JSON to frontend                                │
│  ↓                                                           │
│  uPlot Chart: Renders with gap awareness                   │
│  - Gray out gap regions                                    │
│  - Show gap tooltips on hover                              │
└─────────────────────────────────────────────────────────────┘
```

## Database Schema

### New `recordings` Table

```sql
-- Drop old tables (after data migration)
-- DROP TABLE imu_samples;
-- DROP TABLE imu_data_files;

CREATE TABLE recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- File info
  filename TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('vtx', 'fit')),
  storage_path TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL,

  -- Time range (from file header)
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER NOT NULL,

  -- Data continuity tracking
  -- Array of continuous data ranges as [start_ms, end_ms] offsets from start_time
  -- Example: [[0, 30000], [35000, 60000]] means data from 0-30s and 35-60s (5s gap)
  data_ranges INTEGER[][] NOT NULL DEFAULT '{{}}',

  -- Gap statistics (computed from data_ranges)
  gap_info JSONB, -- {total_gaps: 2, largest_gap_ms: 5000, gap_percentage: 8.3, gap_details: [...]}

  -- Sampling info (VTX specific, NULL for FIT)
  sample_rate REAL,
  sample_count BIGINT,
  record_format INTEGER, -- VTX bitmask for what sensors are included

  -- Device metadata (parsed from file)
  device_info JSONB, -- {id, name, firmware_version, calibration}

  -- Session metadata
  session_metadata JSONB, -- {bike, position, notes, tags, weather, etc}

  -- Computed analysis results (added by post-processing jobs)
  analysis_results JSONB, -- {max_accel, rms_values, frequency_peaks, etc}

  -- Processing status
  status TEXT NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded', 'processing', 'ready', 'failed')),
  error_message TEXT,

  -- Timestamps
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  -- Indexes
  CONSTRAINT recordings_user_filename_key UNIQUE (user_id, filename)
);

CREATE INDEX idx_recordings_user_id ON recordings(user_id);
CREATE INDEX idx_recordings_start_time ON recordings(start_time);
CREATE INDEX idx_recordings_status ON recordings(status);
CREATE INDEX idx_recordings_file_type ON recordings(file_type);
CREATE INDEX idx_recordings_user_time ON recordings(user_id, start_time DESC);

-- GIN index for JSONB queries (optional, if querying gap_info or metadata)
CREATE INDEX idx_recordings_gap_info ON recordings USING GIN(gap_info);
CREATE INDEX idx_recordings_device_info ON recordings USING GIN(device_info);

-- Optional: Store derived/processed data separately
CREATE TABLE recording_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id UUID NOT NULL REFERENCES recordings(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL, -- 'power_spectral_density', 'vibration_metrics', etc
  time_range TSTZRANGE, -- Time range this analysis covers (NULL = entire recording)
  results JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT recording_analysis_unique UNIQUE (recording_id, analysis_type, time_range)
);

CREATE INDEX idx_recording_analysis_recording ON recording_analysis(recording_id);
CREATE INDEX idx_recording_analysis_type ON recording_analysis(analysis_type);
```

### Data Ranges Schema Design

**Format:** Array of `[start_offset_ms, end_offset_ms]` pairs

**Example:**
```json
{
  "start_time": "2025-01-15T10:00:00Z",
  "end_time": "2025-01-15T10:10:00Z",
  "duration_ms": 600000,
  "data_ranges": [
    [0, 120000],      // 0s - 2min: data present
    [125000, 480000], // 2min 5s - 8min: data present (5s gap)
    [485000, 600000]  // 8min 5s - 10min: data present (5s gap)
  ],
  "gap_info": {
    "total_gaps": 2,
    "largest_gap_ms": 5000,
    "total_gap_duration_ms": 10000,
    "gap_percentage": 1.67,
    "gap_details": [
      {"start_offset_ms": 120000, "end_offset_ms": 125000, "duration_ms": 5000},
      {"start_offset_ms": 480000, "end_offset_ms": 485000, "duration_ms": 5000}
    ]
  }
}
```

## Gap Detection Algorithm

### Optimal O(n) Single-Pass Algorithm

**Goal:** Detect gaps in timestamp sequence with configurable threshold

**Algorithm:**
```typescript
interface DataRange {
  startOffsetMs: number;
  endOffsetMs: number;
}

interface GapInfo {
  total_gaps: number;
  largest_gap_ms: number;
  total_gap_duration_ms: number;
  gap_percentage: number;
  gap_details: Array<{
    start_offset_ms: number;
    end_offset_ms: number;
    duration_ms: number;
  }>;
}

function detectDataRanges(
  decoder: VTXDecoder,
  gapThresholdMs: number = 100 // Default: 100ms gap threshold
): { ranges: DataRange[], gapInfo: GapInfo } {
  const recordCount = decoder.getHeader().recordCount;
  const ranges: DataRange[] = [];
  const gaps: Array<{ start_offset_ms: number; end_offset_ms: number; duration_ms: number }> = [];

  if (recordCount === 0) {
    return { ranges: [], gapInfo: { total_gaps: 0, largest_gap_ms: 0, total_gap_duration_ms: 0, gap_percentage: 0, gap_details: [] } };
  }

  // Start first range
  let rangeStartOffset = decoder.readRecord(0).timestampOffset;
  let lastTimestampOffset = rangeStartOffset;

  // Single pass through all records
  for (let i = 1; i < recordCount; i++) {
    const record = decoder.readRecord(i);
    const currentOffset = record.timestampOffset;
    const timeDiff = currentOffset - lastTimestampOffset;

    // Gap detected (timestamp jump larger than threshold)
    if (timeDiff > gapThresholdMs) {
      // Close current range
      ranges.push({
        startOffsetMs: rangeStartOffset,
        endOffsetMs: lastTimestampOffset
      });

      // Record gap
      gaps.push({
        start_offset_ms: lastTimestampOffset,
        end_offset_ms: currentOffset,
        duration_ms: timeDiff
      });

      // Start new range
      rangeStartOffset = currentOffset;
    }

    lastTimestampOffset = currentOffset;
  }

  // Close final range
  ranges.push({
    startOffsetMs: rangeStartOffset,
    endOffsetMs: lastTimestampOffset
  });

  // Compute gap statistics
  const totalGapDuration = gaps.reduce((sum, gap) => sum + gap.duration_ms, 0);
  const largestGap = gaps.length > 0 ? Math.max(...gaps.map(g => g.duration_ms)) : 0;
  const totalDuration = decoder.getHeader().endTimestamp - decoder.getHeader().startTimestamp;
  const gapPercentage = totalDuration > 0 ? (totalGapDuration / totalDuration) * 100 : 0;

  return {
    ranges,
    gapInfo: {
      total_gaps: gaps.length,
      largest_gap_ms: largestGap,
      total_gap_duration_ms: totalGapDuration,
      gap_percentage: Math.round(gapPercentage * 100) / 100,
      gap_details: gaps
    }
  };
}
```

**Complexity:**
- **Time:** O(n) - Single pass through all records
- **Space:** O(g) where g = number of gaps (typically << n)

**Optimization for Large Files:**
- Can sample every Nth record for approximate gap detection (O(n/k))
- For 100Hz data, sampling every 10th record still detects >1s gaps
- Trade-off: Speed vs gap detection granularity

**Gap Threshold Rationale:**
- 500ms default = 50 samples @ 100Hz
- Catches significant interruptions (device sleep, connection loss)
- Ignores minor timestamp jitter and brief interruptions
- Configurable per upload if needed

### Alternative: Streaming Gap Detection

For extremely large files (>1GB), use streaming approach:

```typescript
async function streamingGapDetection(
  storageUrl: string,
  chunkSizeRecords: number = 10000
): AsyncGenerator<{ range: DataRange, gap?: GapInfo }> {
  // Read header first (64 bytes)
  const headerBuffer = await fetchRange(storageUrl, 0, 64);
  const decoder = new VTXDecoder(headerBuffer);
  const header = decoder.getHeader();

  // Stream records in chunks
  let lastTimestamp = null;
  let rangeStart = null;

  for (let offset = 0; offset < header.recordCount; offset += chunkSizeRecords) {
    const chunkBuffer = await fetchRecordRange(storageUrl, offset, chunkSizeRecords);
    // Process chunk...
    yield { range: /* ... */, gap: /* ... */ };
  }
}
```

## Implementation Plan

### Phase 1: Database Migration
1. Drop old `imu_samples` and `imu_data_files` tables
2. Create new `recordings` table (idempotent)
3. Create `recordings` storage bucket in Supabase

### Phase 2: VTX Upload Pipeline
1. Add `@vertex/vtx-parser` to web dependencies
2. Update upload API to accept `.vtx` and `.fit` files only
3. Remove all CSV upload/parsing code
4. Implement fast header extraction (64 bytes)
5. Implement gap detection algorithm (500ms threshold)
6. Store file in Supabase Storage bucket `recordings`
7. Insert metadata into `recordings` table

### Phase 3: VTX Streaming API
1. Create `/api/data/[id]/samples` endpoint
2. Implement VTX decoder integration
3. Add time-range querying with O(1) seeking
4. Implement LTTB downsampling
5. Add response caching (Redis or edge cache)

### Phase 4: Chart Updates
1. Update chart component to fetch from new API
2. Add gap visualization (gray regions)
3. Add gap tooltips/legends
4. Implement progressive loading on zoom
5. Add loading states for large files

### Phase 5: Cleanup
1. Remove old CSV parsing code
2. Remove Inngest `parse-imu` function
3. Remove old API routes
4. Archive or drop old tables
5. Update documentation

## API Specifications

### Upload API: `POST /api/upload`

**Request:**
```typescript
FormData {
  file: File // .vtx or .fit
}
```

**Response:**
```typescript
{
  id: string
  filename: string
  file_type: 'vtx' | 'fit'
  status: 'processing' | 'ready'
  file_size_bytes: number
  start_time: string
  end_time: string
  duration_ms: number
  data_ranges: [number, number][]
  gap_info: {
    total_gaps: number
    largest_gap_ms: number
    gap_percentage: number
  }
  sample_rate: number
  sample_count: number
}
```

### Samples API: `GET /api/data/[id]/samples`

**Query Parameters:**
- `start`: ISO timestamp (optional, filter start)
- `end`: ISO timestamp (optional, filter end)
- `resolution`: number (default 2000, target sample count)
- `downsample`: 'lttb' | 'none' (default 'lttb')

**Response:**
```typescript
{
  samples: Array<{
    timestamp: number // Unix ms
    accel: { x: number, y: number, z: number }
    gyro: { x: number, y: number, z: number }
    mag?: { x: number, y: number, z: number }
    quat?: { w: number, x: number, y: number, z: number }
  }>
  metadata: {
    total_samples: number
    downsampled: boolean
    downsampling_ratio: number
    time_range: { start: number, end: number }
  }
  gaps: Array<{
    start: number // Unix ms
    end: number
    duration_ms: number
  }>
}
```

## Migration Timeline

**Estimated Time:** 2-3 days

- **Day 1 Morning:** Database schema + migration script
- **Day 1 Afternoon:** Upload pipeline refactor
- **Day 2 Morning:** Streaming API implementation
- **Day 2 Afternoon:** Chart updates with gap visualization
- **Day 3:** Testing, bug fixes, cleanup

## Rollback Plan

1. VTX files stored in object storage (not deleted)
2. Can rebuild `recordings` table from files if needed
3. Schema migrations are idempotent
4. Storage bucket versioning enabled for safety

## Success Metrics

- Upload time: <5s for 100MB VTX file (vs 30-60s CSV parsing)
- Query time: <1s for 2000-point chart (any time range)
- Storage cost: 70% reduction vs sample storage
- Database size: <1MB per 1000 recordings (vs 100MB+)

## Security Considerations

1. **File validation:** Check magic bytes "VTX\0" before processing
2. **Size limits:** 500MB max file size (configurable)
3. **Signed URLs:** 1-hour expiry for storage access
4. **Rate limiting:** 10 uploads/minute per user
5. **Virus scanning:** Optional ClamAV integration for uploads

## Future Enhancements

1. **Delta compression:** Store only changes between recordings
2. **Multi-file sessions:** Combine multiple VTX files into one session
3. **Cloud processing:** AWS Lambda for large file analysis
4. **Real-time streaming:** WebSocket for live IMU data
5. **ML model serving:** On-demand feature extraction

## References

- VTX Format Spec: `/packages/vtx-format/spec/v1.0.md`
- VTX Parser: `/packages/vtx-parser/README.md`
- Current Schema: `/web/src/types/database.types.ts`
- Upload Code: `/web/src/app/upload/page.tsx`
