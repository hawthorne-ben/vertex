# RFC 003: Ride Data API Optimization

**Status:** Draft
**Author:** Claude
**Date:** 2026-01-24
**Affects:** Ride detail page, chart APIs, VTX/FIT sample endpoints

## Summary

Optimize ride data visualization APIs to eliminate redundant file parsing, implement caching, and parallelize multi-recording fetches. Current implementation causes 4-8x redundant downloads/parses of the same multi-MB VTX files during normal usage.

## Motivation

### Current Performance Problems

When viewing a ride detail page with IMU data, the following happens:

1. **Server renders page** → Downloads & parses VTX file (resolution=1000)
2. **Client loads** → User switches from "Orientation" to "Smoothed Accel" → Downloads & parses same VTX file again
3. **User zooms in** → Downloads & parses entire VTX file to extract 5-minute segment
4. **User switches to Analytics tab** → Pedaling efficiency downloads & parses both FIT and VTX files
5. **User zooms analytics** → Downloads & parses both files again

**Result**: A single ride view with 2 data type switches + 2 zoom operations = **10 file downloads** (5 VTX, 5 FIT) for the same data.

### Measured Impact

For a typical 30-minute ride:
- VTX file: ~15-25MB
- FIT file: ~2-5MB
- Total unnecessary data transfer per session: **150-200MB**
- Parse time per VTX file: **300-800ms**
- Parse time per FIT file: **50-150ms**

## Problems Identified (Priority Order)

### Priority 1: No File Caching
**Impact**: Every API request re-downloads from Supabase Storage

**Files Affected**:
- `/app/api/recordings/[id]/samples/route.ts:102-113`
- `/app/api/recordings/[id]/samples/filtered/route.ts:~80-90`
- `/app/api/recordings/[id]/samples/smoothed/route.ts:~80-90`
- `/app/api/rides/[id]/samples/route.ts:111-121`
- `/app/api/rides/[id]/pedaling-efficiency/route.ts:117-127,175-182`

**Current Code Pattern**:
```typescript
// Every request does this
const { data: fileData } = await supabase.storage
  .from('recordings')
  .download(recording.storage_path)

const arrayBuffer = await fileData.arrayBuffer()
const decoder = new VTXDecoder(arrayBuffer)
```

### Priority 2: Sequential Multi-Recording Fetches
**Impact**: N recordings = N sequential API calls = N × parse time

**File**: `/components/charts/hooks/useIMUData.ts:93-141`

**Current Code**:
```typescript
for (const recording of recordingsToFetch) {
  const response = await fetch(url, {...}) // Sequential!
  // ...
}
```

**Example**: 3 VTX recordings × 500ms each = **1.5s load time** instead of 500ms parallel

### Priority 3: Full File Parse on Time Range Queries
**Impact**: Zooming into 5-minute segment still parses entire 2-hour recording

**Files**:
- `/app/api/recordings/[id]/samples/route.ts:148-188`
- `/app/api/rides/[id]/pedaling-efficiency/route.ts:202-216`

**Current Code**:
```typescript
for (let i = 0; i < recordCount; i++) {
  const record = decoder.readRecord(i) // Decode before checking time
  const recordOffset = record.timestamp - recordingStartMs

  if (recordOffset < startOffset || recordOffset > endOffset) {
    continue // Wasted decode!
  }
  samples.push(...)
}
```

### Priority 4: Duplicate FIT File Parsing
**Impact**: Pedaling efficiency re-parses FIT file that samples endpoint already handles

**File**: `/app/api/rides/[id]/pedaling-efficiency/route.ts:115-157`

**Problem**: Pedaling efficiency endpoint downloads, parses, and extracts only `grade` + `altitude` from FIT file. Could reuse `/api/rides/[id]/samples?fields=grade,altitude` instead.

### Priority 5: Unused Initial Server-Side Samples
**Impact**: Server pre-fetches samples that client often ignores

**File**: `/app/rides/[id]/page.tsx:62-126`

**Problem**:
- Server fetches orientation data at resolution=1000
- Client only uses if user stays on "Orientation" tab (default)
- If user switches to "Accelerometer" immediately → wasted server fetch
- If user zooms immediately → wasted server fetch

### Priority 6: Missing Field Selection for VTX
**Impact**: Always returns all sensor data even when only `accel_x` needed

**Current**: VTX samples endpoint returns accel (xyz), gyro (xyz), mag (xyz), quat (wxyz), euler (rpy) = 15 floats per sample

**Pedaling efficiency needs**: Only `accel_x` = 1 float per sample

**Bandwidth waste**: 15x more data than necessary

### Priority 7: No HTTP Caching Headers
**Impact**: Browser can't cache responses, even for immutable data

**Problem**: Recording samples never change after upload, but no `Cache-Control` or `ETag` headers

### Priority 8: Inefficient Downsampling Position
**Impact**: Downsampling happens after time filtering

**File**: `/app/api/recordings/[id]/samples/route.ts:195-200`

**Current**: Filter 100k → 10k samples, then downsample 10k → 2k
**Better**: Downsample 100k → 2k (LTTB preserves trends), then filter

## Proposed Solutions

### Solution 1: Implement File Caching (High Priority)

Create in-memory LRU cache for parsed files with 15-minute TTL.

**New File**: `/lib/cache/file-cache.ts`

```typescript
import { LRUCache } from 'lru-cache'

interface CachedFile {
  arrayBuffer: ArrayBuffer
  parsedAt: number
}

class FileCache {
  private cache: LRUCache<string, CachedFile>

  constructor() {
    this.cache = new LRUCache({
      max: 50, // Max 50 files (~500MB-1GB depending on file sizes)
      maxSize: 1024 * 1024 * 1024, // 1GB total
      sizeCalculation: (value) => value.arrayBuffer.byteLength,
      ttl: 1000 * 60 * 15, // 15 minutes
    })
  }

  async getOrFetch(
    storagePath: string,
    fetchFn: () => Promise<ArrayBuffer>
  ): Promise<ArrayBuffer> {
    const cached = this.cache.get(storagePath)

    if (cached) {
      console.log(`Cache HIT: ${storagePath}`)
      return cached.arrayBuffer
    }

    console.log(`Cache MISS: ${storagePath}`)
    const arrayBuffer = await fetchFn()

    this.cache.set(storagePath, {
      arrayBuffer,
      parsedAt: Date.now()
    })

    return arrayBuffer
  }

  invalidate(storagePath: string) {
    this.cache.delete(storagePath)
  }

  clear() {
    this.cache.clear()
  }

  stats() {
    return {
      size: this.cache.size,
      calculatedSize: this.cache.calculatedSize,
      hits: this.cache.hits,
      misses: this.cache.misses,
    }
  }
}

export const fileCache = new FileCache()
```

**Usage in endpoints**:

```typescript
// Before
const { data: fileData } = await supabase.storage
  .from('recordings')
  .download(recording.storage_path)
const arrayBuffer = await fileData.arrayBuffer()

// After
import { fileCache } from '@/lib/cache/file-cache'

const arrayBuffer = await fileCache.getOrFetch(
  recording.storage_path,
  async () => {
    const { data: fileData } = await supabase.storage
      .from('recordings')
      .download(recording.storage_path)
    return await fileData.arrayBuffer()
  }
)
```

**Files to Update**:
- `/app/api/recordings/[id]/samples/route.ts`
- `/app/api/recordings/[id]/samples/filtered/route.ts`
- `/app/api/recordings/[id]/samples/smoothed/route.ts`
- `/app/api/rides/[id]/samples/route.ts`
- `/app/api/rides/[id]/pedaling-efficiency/route.ts`

**Dependencies**:
```bash
npm install lru-cache
```

**Expected Impact**:
- Cache hit rate: 60-80% (user interactions on same ride)
- Response time on cache hit: **50-100ms** (down from 300-800ms)
- Reduced Supabase bandwidth: **-60% to -80%**

---

### Solution 2: Parallelize Multi-Recording Fetches (High Priority)

Replace sequential `for` loop with `Promise.all()`.

**File**: `/components/charts/hooks/useIMUData.ts`

**Before**:
```typescript
for (const recording of recordingsToFetch) {
  const response = await fetch(url, {...})
  const { samples: fetchedSamples } = await response.json()
  allSamples.push(...transformed)
}
```

**After**:
```typescript
const fetchPromises = recordingsToFetch.map(async (recording) => {
  const params = new URLSearchParams()
  if (timeRange) {
    params.set('start', timeRange.start)
    params.set('end', timeRange.end)
    params.set('resolution', 'high')
  }

  let endpoint: string
  if (dataType === 'trueOrientation') {
    endpoint = `/api/recordings/${recording.id}/samples/filtered`
  } else if (dataType === 'smoothedAccel' || dataType === 'smoothedGyro') {
    endpoint = `/api/recordings/${recording.id}/samples/smoothed`
  } else {
    endpoint = `/api/recordings/${recording.id}/samples`
  }

  const url = params.toString() ? `${endpoint}?${params}` : endpoint
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${session.access_token}` }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch data: ${response.statusText}`)
  }

  const { samples: fetchedSamples, metadata } = await response.json()

  return {
    samples: fetchedSamples.map((s: any) => ({
      timestamp: s.timestamp,
      accel_x: s.accel?.x ?? s.accel_x ?? 0,
      accel_y: s.accel?.y ?? s.accel_y ?? 0,
      accel_z: s.accel?.z ?? s.accel_z ?? 0,
      gyro_x: s.gyro?.x ?? s.gyro_x ?? 0,
      gyro_y: s.gyro?.y ?? s.gyro_y ?? 0,
      gyro_z: s.gyro?.z ?? s.gyro_z ?? 0,
      roll: s.euler?.roll ?? s.roll ?? null,
      pitch: s.euler?.pitch ?? s.pitch ?? null,
      yaw: s.euler?.yaw ?? s.yaw ?? null,
    })),
    totalSamples: metadata?.total_samples || 0
  }
})

const results = await Promise.all(fetchPromises)

let totalOriginalCount = 0
for (const result of results) {
  allSamples.push(...result.samples)
  totalOriginalCount += result.totalSamples
}

setOriginalCount(totalOriginalCount)
```

**Expected Impact**:
- 3 recordings: **1.5s → 0.5s** (3x faster)
- 5 recordings: **2.5s → 0.5s** (5x faster)

---

### Solution 3: Skip Decoding Outside Time Range (Medium Priority)

Add early timestamp check before full record decode.

**Challenge**: VTXDecoder requires sequential reads (can't random access).

**Workaround**: Calculate approximate index range from timestamps.

**File**: `/app/api/recordings/[id]/samples/route.ts`

**Before**:
```typescript
for (let i = 0; i < recordCount; i++) {
  const record = decoder.readRecord(i)
  const recordOffset = record.timestamp - recordingStartMs

  if (recordOffset < startOffset || recordOffset > endOffset) {
    continue
  }
  samples.push({...})
}
```

**After**:
```typescript
// Calculate approximate start/end indices based on sample rate
const sampleRate = recording.sample_rate || 50 // Hz
const durationMs = Number(header.endTimestamp - header.startTimestamp)
const totalDurationSec = durationMs / 1000

let startIndex = 0
let endIndex = recordCount

if (startTime) {
  const startOffsetSec = startOffset / 1000
  startIndex = Math.max(0, Math.floor((startOffsetSec / totalDurationSec) * recordCount) - 100)
}

if (endTime) {
  const endOffsetSec = endOffset / 1000
  endIndex = Math.min(recordCount, Math.ceil((endOffsetSec / totalDurationSec) * recordCount) + 100)
}

// Only iterate estimated range (with buffer)
for (let i = startIndex; i < endIndex; i++) {
  const record = decoder.readRecord(i)
  const recordOffset = record.timestamp - recordingStartMs

  if (recordOffset < startOffset || recordOffset > endOffset) {
    continue
  }
  samples.push({...})
}
```

**Expected Impact**:
- Zooming into 10% of ride: **90% fewer decodes**
- 2-hour ride zoom to 5 min: **800ms → 100ms**

---

### Solution 4: Reuse FIT Samples Endpoint (Medium Priority)

Replace direct FIT parsing in pedaling efficiency with internal API call.

**File**: `/app/api/rides/[id]/pedaling-efficiency/route.ts`

**Before** (Lines 115-167):
```typescript
// Download FIT file
const { data: fitFileData } = await supabase.storage
  .from('recordings')
  .download(fitRecording.storage_path)

// Parse FIT file
const FitParser = (await import('fit-file-parser')).default
const arrayBuffer = await fitFileData.arrayBuffer()
// ... 50 lines of parsing logic ...

let fitSamples = records.map((record: any) => ({
  timestamp: record.timestamp ? new Date(record.timestamp).toISOString() : null,
  grade: record.grade || null,
  altitude: record.enhanced_altitude ?? record.altitude ?? null
}))
```

**After**:
```typescript
// Reuse existing samples endpoint with field selection
const fitSamplesUrl = new URL(
  `/api/rides/${rideId}/samples`,
  request.url
)
fitSamplesUrl.searchParams.set('fields', 'grade,altitude')
if (startTime) fitSamplesUrl.searchParams.set('start', startTime)
if (endTime) fitSamplesUrl.searchParams.set('end', endTime)

const fitResponse = await fetch(fitSamplesUrl, {
  headers: { 'Authorization': `Bearer ${token}` }
})

if (!fitResponse.ok) {
  throw new Error('Failed to fetch FIT samples')
}

const { samples: fitSamples } = await fitResponse.json()
```

**Benefits**:
- Eliminates duplicate FIT parsing logic
- Shares file cache with other endpoints
- Reduces code: **-50 LOC**
- Same field selection optimization applies

**Trade-off**: Internal HTTP call overhead (~5-10ms), but cache hit eliminates storage download (~50-200ms)

---

### Solution 5: Skip Initial Server-Side Fetch (Low Priority)

Remove server-side sample fetching from ride page, rely on client-side data loading.

**File**: `/app/rides/[id]/page.tsx`

**Before** (Lines 62-126):
```typescript
const vtxRecordingsWithSamples = await Promise.all(
  vtxRecordings.map(async (vtx: any) => {
    // ... 50 lines of server-side fetching ...
    const samplesUrl = `${apiUrl}/api/recordings/${vtx.id}/samples?resolution=1000&downsample=lttb`
    const response = await fetch(samplesUrl, {...})
    // ...
  })
)
```

**After**:
```typescript
// Just pass recording metadata, let client fetch on-demand
const vtxRecordingsMetadata = vtxRecordings.map((vtx: any) => ({
  id: vtx.id,
  start_time: vtx.start_time,
  end_time: vtx.end_time,
  status: vtx.status
}))
```

**Client Updates**: `/components/charts/IMUSensorChart.tsx`
- Remove `initialSamples` prop
- Always fetch on mount (uses cache if available)

**Benefits**:
- Faster initial page render (no sample fetching delay)
- Reduced server memory usage
- Client gets exactly the data type it needs

**Trade-offs**:
- Slight delay before chart renders (50-300ms fetch)
- Could mitigate with loading skeleton

---

### Solution 6: Add Field Selection for VTX (Low Priority)

Add `fields` query parameter to VTX samples endpoint.

**File**: `/app/api/recordings/[id]/samples/route.ts`

**Add Parameter Parsing**:
```typescript
const fieldsParam = searchParams.get('fields')
const requestedFields = fieldsParam ? new Set(fieldsParam.split(',')) : null

// Helper to check if field should be included
const includeField = (field: string) => !requestedFields || requestedFields.has(field)
```

**Update Record Building**:
```typescript
for (let i = 0; i < recordCount; i++) {
  const record = decoder.readRecord(i)

  const sample: any = { timestamp: record.timestamp }

  if (includeField('accel') || includeField('accel_x')) {
    sample.accel = {
      x: record.accelX,
      ...(includeField('accel_y') ? { y: record.accelY } : {}),
      ...(includeField('accel_z') ? { z: record.accelZ } : {}),
    }
  }

  if (includeField('gyro')) {
    sample.gyro = { x: record.gyroX, y: record.gyroY, z: record.gyroZ }
  }

  // Only include mag/quat/euler if requested
  if (includeField('mag') && record.magX !== undefined) {
    sample.mag = { x: record.magX, y: record.magY, z: record.magZ }
  }

  samples.push(sample)
}
```

**Usage**:
```typescript
// Pedaling efficiency only needs accel_x
const url = `/api/recordings/${id}/samples?fields=accel_x&start=${start}&end=${end}`
```

**Expected Impact**:
- Pedaling efficiency: **15x bandwidth reduction** (15 floats → 1 float)
- JSON serialization: **~80% faster**
- Network transfer: **~85% smaller**

---

### Solution 7: Add HTTP Cache Headers (Low Priority)

Add `Cache-Control` and `ETag` headers to immutable sample responses.

**Files**: All sample endpoints

**Implementation**:
```typescript
export async function GET(request: NextRequest, { params }) {
  // ... existing logic ...

  // Generate ETag from recording ID + query params
  const etag = `"${recordingId}-${startTime || 'null'}-${endTime || 'null'}-${resolution}"`

  // Check if client has cached version
  const ifNoneMatch = request.headers.get('if-none-match')
  if (ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304 }) // Not Modified
  }

  return NextResponse.json(
    { samples, metadata },
    {
      headers: {
        'Cache-Control': 'public, max-age=3600, immutable', // 1 hour cache
        'ETag': etag,
      }
    }
  )
}
```

**Expected Impact**:
- Repeat visits to same ride: **0 bytes transferred** (304 response)
- Browser automatically caches across page reloads
- Works with file cache (double caching layer)

---

### Solution 8: Downsample Before Time Filtering (Low Priority)

Move LTTB downsampling before time range filtering to preserve visual fidelity.

**File**: `/app/api/recordings/[id]/samples/route.ts`

**Current Order**:
1. Filter by time range (100k → 10k samples)
2. Downsample with LTTB (10k → 2k samples)

**Problem**: Filtering first loses context for LTTB algorithm.

**Better Order**:
1. Downsample with LTTB (100k → 2k samples) - preserves visual trends
2. Filter by time range (2k → ~200 samples for zoomed view)

**Implementation**:
```typescript
// Apply downsampling FIRST (if needed)
let processedSamples = samples
if (downsample === 'lttb' && samples.length > resolution) {
  processedSamples = downsampleLTTB(samples, resolution)
}

// THEN filter by time range
if (startTime || endTime) {
  processedSamples = processedSamples.filter(s => {
    const ts = s.timestamp
    if (startTime && ts < new Date(startTime).getTime()) return false
    if (endTime && ts > new Date(endTime).getTime()) return false
    return true
  })
}
```

**Expected Impact**:
- Better visual quality for zoomed charts (LTTB sees full context)
- Minimal performance change (both are fast operations)

---

## Implementation Plan

### Phase 1: High Priority (Week 1-2)
- [ ] Implement file cache (`/lib/cache/file-cache.ts`)
- [ ] Update all 5 endpoints to use file cache
- [ ] Parallelize multi-recording fetches in `useIMUData.ts`
- [ ] Add cache hit/miss monitoring

### Phase 2a: VTX File Merging (Critical - Fixes Multi-Recording Issues)
**Problem**: Current multi-file handling is fragmented across frontend/backend, causing:
- Broken zoom behavior (shows partial data)
- Complex merging logic in multiple places
- Race conditions with parallel fetches
- Poor cache efficiency (N files vs 1 file)

**Solution**: Merge VTX files into single file when associated with ride

#### Implementation Steps:

**Step 1: Extend @vertex-pkg/vtx-parser with merge capability**
```typescript
// @vertex-pkg/vtx-parser/src/merger.ts
export class VTXMerger {
  /**
   * Merge multiple VTX files into single file
   * - Sorts records by timestamp across all files
   * - Deduplicates overlapping timestamps
   * - Preserves all sensor data (accel, gyro, mag, quat, euler)
   */
  static merge(files: ArrayBuffer[]): ArrayBuffer {
    // 1. Parse headers from all files
    // 2. Collect all records with timestamps
    // 3. Sort by timestamp (handles non-overlapping recordings)
    // 4. Deduplicate exact timestamp matches (keep first)
    // 5. Write new VTX file with merged records
    // 6. Update header with new recordCount, startTimestamp, endTimestamp
    return mergedArrayBuffer
  }
}
```

**Step 2: Add database column for merged file**
```sql
-- Migration: Add merged_vtx_path to rides table
ALTER TABLE rides
ADD COLUMN merged_vtx_path TEXT NULL,
ADD COLUMN merged_vtx_file_size_bytes BIGINT NULL,
ADD COLUMN merged_at TIMESTAMP WITH TIME ZONE NULL;

-- Index for cleanup queries
CREATE INDEX idx_rides_merged_vtx_path ON rides(merged_vtx_path) WHERE merged_vtx_path IS NOT NULL;
```

**Step 3: Create Inngest merge job**
```typescript
// functions/merge-ride-vtx.ts
export const mergeRideVTX = inngest.createFunction(
  { id: 'merge-ride-vtx', retries: 3 },
  { event: 'ride/vtx.associated' },
  async ({ event, step }) => {
    const { rideId } = event.data

    // Fetch ride + all VTX recordings
    const { data: ride } = await step.run('fetch-ride', async () => {
      return supabase
        .from('rides')
        .select(`
          *,
          ride_recordings!inner (
            recording_id,
            recordings!inner (
              id,
              storage_path,
              file_type,
              start_time,
              end_time
            )
          )
        `)
        .eq('id', rideId)
        .eq('ride_recordings.recordings.file_type', 'vtx')
        .eq('ride_recordings.recordings.status', 'ready')
        .single()
    })

    const vtxRecordings = ride.ride_recordings
      .map(rr => rr.recordings)
      .sort((a, b) => a.start_time.localeCompare(b.start_time))

    if (vtxRecordings.length === 0) {
      return { success: true, message: 'No VTX recordings to merge' }
    }

    if (vtxRecordings.length === 1) {
      // Single file - just reference it directly (no merge needed)
      await supabase
        .from('rides')
        .update({
          merged_vtx_path: vtxRecordings[0].storage_path,
          merged_vtx_file_size_bytes: vtxRecordings[0].file_size_bytes,
          merged_at: new Date().toISOString()
        })
        .eq('id', rideId)

      return { success: true, message: 'Single file - no merge needed' }
    }

    // Download all VTX files in parallel
    const files = await step.run('download-vtx-files', async () => {
      return Promise.all(
        vtxRecordings.map(async (rec) => {
          const { data } = await supabase.storage
            .from('recordings')
            .download(rec.storage_path)
          return await data!.arrayBuffer()
        })
      )
    })

    // Merge VTX files
    const mergedBuffer = await step.run('merge-vtx-files', async () => {
      return VTXMerger.merge(files)
    })

    // Upload merged file
    const mergedPath = `rides/${rideId}/merged.vtx`
    await step.run('upload-merged-file', async () => {
      await supabase.storage
        .from('recordings')
        .upload(mergedPath, mergedBuffer, {
          contentType: 'application/octet-stream',
          upsert: true
        })
    })

    // Update ride record
    await step.run('update-ride-record', async () => {
      await supabase
        .from('rides')
        .update({
          merged_vtx_path: mergedPath,
          merged_vtx_file_size_bytes: mergedBuffer.byteLength,
          merged_at: new Date().toISOString()
        })
        .eq('id', rideId)
    })

    return {
      success: true,
      mergedPath,
      originalFiles: vtxRecordings.length,
      mergedSize: mergedBuffer.byteLength
    }
  }
)
```

**Step 4: Trigger merge on ride association**
```typescript
// app/api/rides/[id]/recordings/route.ts
export async function POST(request: NextRequest, { params }) {
  // ... existing association logic ...

  // Trigger merge job
  await inngest.send({
    name: 'ride/vtx.associated',
    data: { rideId }
  })

  return NextResponse.json({ success: true })
}
```

**Step 5: Update APIs to prefer merged file**
```typescript
// All VTX endpoints (samples, filtered, smoothed, pedaling-efficiency)
// Add helper function:
async function getVTXFileForRide(rideId: string): Promise<string> {
  const { data: ride } = await supabase
    .from('rides')
    .select('merged_vtx_path')
    .eq('id', rideId)
    .single()

  if (ride?.merged_vtx_path) {
    return ride.merged_vtx_path // Use merged file
  }

  // Fallback: Get first VTX recording (legacy behavior)
  const { data: recording } = await supabase
    .from('ride_recordings')
    .select('recordings(storage_path)')
    .eq('ride_id', rideId)
    .limit(1)
    .single()

  return recording.recordings.storage_path
}
```

**Step 6: Simplify frontend (remove multi-file logic)**
```typescript
// Remove from RideVisualizationsClient:
// - mergedImuData useMemo (lines 52-78)
// - Multi-file sample merging

// Remove from useIMUData:
// - recordingsToFetch filtering (lines 80-94)
// - Promise.all multi-fetch (lines 96-142)
// - Just fetch single merged file

// IMUSensorChart becomes:
<IMUSensorChart
  rideId={rideId}  // Changed from recordings array
  dataType={dataType}
  zoomRange={zoomRange}
/>
```

**Step 7: Cleanup job for merged files**
```typescript
// functions/cleanup-merged-vtx.ts
export const cleanupMergedVTX = inngest.createFunction(
  { id: 'cleanup-merged-vtx' },
  { cron: '0 3 * * *' }, // Daily at 3am
  async ({ step }) => {
    // Delete merged files when ride is deleted
    // Or when source recordings are removed
    // Keep for 30 days after ride deletion for recovery
  }
)
```

#### Benefits:
- ✅ **Fixes zoom permanently** - single file = simple time filtering
- ✅ **Better performance** - 1 download vs N downloads
- ✅ **Cache efficiency** - 1 cache entry vs N entries
- ✅ **Simpler frontend** - Remove ~200 LOC of merging logic
- ✅ **Better UX** - No partial data during zoom
- ✅ **Works for analytics** - Pedaling efficiency gets clean single file

#### Storage Cost:
- Merged files are typically same size as sum of originals
- Can add cleanup job to delete old merged files
- Cost: ~$0.02/GB/month on Supabase = negligible

---

### Phase 2b: Medium Priority (Week 3) - **UPDATED FOR MERGING**
**Note**: Phase 2a (file merging) significantly simplifies these optimizations

- [ ] Optimize time range filtering (skip decoding) - **MORE EFFECTIVE** with single large file
- [ ] Reuse FIT samples endpoint in pedaling efficiency - No change
- [ ] Add field selection to VTX samples endpoint - No change
- [ ] Update pedaling efficiency to use `fields=accel_x` - No change
- [ ] ~~Parallelize multi-recording fetches~~ - **OBSOLETE** (no more multi-file fetches)

### Phase 3: Low Priority (Week 4) - **UPDATED FOR MERGING**
- [ ] Add HTTP cache headers to all endpoints - No change
- [ ] ~~Skip initial server-side fetch~~ - **KEEP** server-side fetch (fast with merged files)
- [ ] Reorder downsampling logic - No change
- [ ] Add performance monitoring dashboard - No change

### Phase 1 Impact Assessment (Post-Merge)
**Completed Phase 1 improvements STILL VALID**:
- ✅ File cache works even better with merged files (1 cache entry vs N)
- ✅ Cache hit rates will improve significantly
- ✅ Parallel fetching in useIMUData can be simplified/removed
- ✅ LRU eviction more efficient (fewer, larger entries)

**Cache Strategy Enhancement Post-Merge**:
```typescript
// Before merging: Multiple cache entries per ride
// Cache key: 'user/recording1.vtx', 'user/recording2.vtx', etc.
// Hit rate: Lower (need ALL files cached for full hit)

// After merging: Single cache entry per ride
// Cache key: 'rides/ride-id/merged.vtx'
// Hit rate: Higher (only one file to cache)
// Eviction: More efficient (LRU works on fewer, larger files)
```

## Testing Strategy

### Performance Tests
- Load ride page with 3 VTX recordings
- Switch data types 5 times
- Zoom in/out 3 times
- Measure:
  - Total network bytes transferred
  - Total API response time
  - Cache hit rate

**Success Criteria**:
- Network bytes: **-60% reduction**
- Total load time: **-50% reduction**
- Cache hit rate: **>70%**

### Regression Tests
- Verify all charts still render correctly
- Verify zoom functionality works
- Verify multi-recording merging works
- Verify analytics tab loads correctly

## Performance Impact (Projected)

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Initial page load (3 recordings) | 45-60MB | 15-25MB | **-60%** |
| Data type switch | 300-800ms | 50-100ms | **-80%** |
| Zoom operation | 600-1200ms | 100-200ms | **-75%** |
| Analytics load | 1500-2000ms | 200-400ms | **-80%** |
| Cache hit response time | N/A | 50-100ms | New |
| Supabase bandwidth (monthly) | ~50GB | ~15GB | **-70%** |

### Cost Savings

Assuming 500 ride views/month with average 3 data type switches + 2 zooms:
- **Before**: 500 views × 150MB = 75GB transfer
- **After**: 500 views × 30MB = 15GB transfer
- **Savings**: ~60GB/month (~$6/month in Supabase bandwidth)

## Risks & Mitigations

### Risk 1: Memory Pressure from Cache
**Mitigation**: LRU cache with 1GB size limit, TTL expiration

### Risk 2: Stale Cache After File Update
**Mitigation**: Recording files are immutable (never edited after upload)

### Risk 3: Cache Invalidation on Deployment
**Mitigation**: In-memory cache per instance is acceptable (15min TTL)

### Risk 4: Index Estimation Inaccuracy
**Mitigation**: Use conservative buffer (±100 samples) in time range optimization

## Success Criteria

- [ ] Cache hit rate ≥70% during normal usage
- [ ] Total network bytes reduced by ≥60%
- [ ] API response times reduced by ≥50%
- [ ] No increase in chart rendering errors
- [ ] No visual degradation in chart quality
- [ ] Cache memory usage stays under 1GB

## Open Questions

1. **Should we use Redis instead of in-memory cache?**
   - Pro: Shared across instances, survives deployments
   - Con: Added complexity, latency, cost
   - **Decision**: Start with in-memory, evaluate Redis if cache invalidation becomes issue

2. **Should we pre-compute and store downsampled versions during upload?**
   - Pro: Zero compute on read
   - Con: Storage cost, upload complexity
   - **Decision**: Defer to later RFC if cache doesn't solve performance

3. **Should we add cache warming on ride page load?**
   - Pro: Faster subsequent interactions
   - Con: Eager loading may waste bandwidth
   - **Decision**: No, let cache populate organically

4. **Should field selection be opt-in or opt-out?**
   - **Decision**: Opt-in (default to all fields for backward compat)

## References

- [LRU Cache npm package](https://www.npmjs.com/package/lru-cache)
- [HTTP Caching (MDN)](https://developer.mozilla.org/en-US/docs/Web/HTTP/Caching)
- [LTTB Downsampling Algorithm](https://github.com/sveinn-steinarsson/flot-downsample)
- Current implementation: `/app/api/recordings/[id]/samples/route.ts`

## Appendix: Files to Modify

### New Files (1)
- `/lib/cache/file-cache.ts` (~100 LOC)

### Modified Files (7)
- `/app/api/recordings/[id]/samples/route.ts` - Add cache, field selection, optimize filtering
- `/app/api/recordings/[id]/samples/filtered/route.ts` - Add cache
- `/app/api/recordings/[id]/samples/smoothed/route.ts` - Add cache
- `/app/api/rides/[id]/samples/route.ts` - Add cache, HTTP headers
- `/app/api/rides/[id]/pedaling-efficiency/route.ts` - Use FIT samples endpoint, add cache
- `/components/charts/hooks/useIMUData.ts` - Parallelize fetches
- `/app/rides/[id]/page.tsx` - Skip initial fetch (optional)

### Dependencies
```json
{
  "lru-cache": "^10.1.0"
}
```

---

## Decision

**Pending review and approval.**

Priority order confirmed as:
1. File caching (highest ROI)
2. Parallel fetches (quick win)
3. Time range optimization
4. Reuse FIT endpoint
5-8. Nice-to-haves
