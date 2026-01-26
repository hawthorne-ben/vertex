# RFC 005: Pedaling Efficiency Background Processing

**Status:** Draft
**Author:** Claude
**Date:** 2026-01-25
**Affects:** Pedaling efficiency API, ride analytics, database schema, Inngest jobs

## Summary

Move pedaling efficiency computation from on-demand API endpoint to background Inngest job triggered after ride association. Store precomputed results in database with proper caching, and convert API endpoint to lightweight data retrieval wrapper.

## Motivation

### Current Implementation Problems

The current pedaling efficiency endpoint (`/api/rides/[id]/pedaling-efficiency`) performs **expensive real-time computation** on every request:

1. **Fetches and parses FIT file** (~2-5MB, 50-150ms)
2. **Fetches and parses VTX file** (~15-25MB, 300-800ms)
3. **High-pass filters acceleration data** (linear time, ~50-100ms)
4. **Runs FFT-based cadence detection** with 10-second rolling windows (~100-200ms)
5. **Calculates efficiency scores** with 3-second rolling windows (~50-100ms)
6. **Returns full time series** (often 10k-50k samples)

**Total processing time**: 500-1250ms per request
**Total data processed**: 17-30MB per request

### Why This Is Problematic

1. **User Experience**: 0.5-1.25s wait time before charts render
2. **Resource Waste**: Same computation repeated on every page load, zoom, or parameter change
3. **Compute Cost**: CPU-intensive FFT operations on every request
4. **Bandwidth Waste**: Downloading raw files even when results are cached
5. **No Progressive Loading**: Can't show partial results while computing
6. **Blocks UI Thread**: Large JSON payloads (2-10MB) freeze browser during parse

### Similar Pattern Already Solved

We successfully moved VTX file merging to background processing (RFC 003, Phase 2a):
- ✅ **Inngest job** triggered on `ride/vtx.associated` event
- ✅ **Pre-merged file** stored in `rides.merged_vtx_path`
- ✅ **Fast API** just downloads pre-merged file
- ✅ **Result**: 4-6s → 0.15s for VTX data fetch

Pedaling efficiency should follow the same pattern.

## Proposed Solution

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│ Trigger: POST /api/rides/[id]/recordings                │
│ (Associate VTX+FIT recordings with ride)                │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
         ┌───────────────┐
         │ Send Inngest  │
         │ Event:        │
         │ ride/         │
         │ associated    │
         └───────┬───────┘
                 │
    ┌────────────┼────────────┐
    ▼                         ▼
┌────────────┐      ┌──────────────────────┐
│ Existing:  │      │ NEW: Pedaling        │
│ Merge VTX  │      │ Efficiency Job       │
│ Files      │      │                      │
└────────────┘      └──────────┬───────────┘
                               │
                ┌──────────────┼──────────────┐
                ▼              ▼              ▼
         ┌──────────┐   ┌──────────┐  ┌────────────┐
         │ Download │   │ Process  │  │ Store in   │
         │ FIT+VTX  │   │ Compute  │  │ Database   │
         │ Files    │   │ FFT+     │  │            │
         │          │   │ Filters  │  │            │
         └──────────┘   └──────────┘  └────────────┘
                                             │
                                             ▼
                              ┌─────────────────────────────┐
                              │ API: GET /api/rides/[id]/   │
                              │      pedaling-efficiency    │
                              │                             │
                              │ Returns precomputed data    │
                              │ with processing state       │
                              └─────────────────────────────┘
```

### Component Design

#### 1. Database Schema Changes

**New table: `ride_analysis`**
```sql
CREATE TABLE ride_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL CHECK (analysis_type IN ('pedaling_efficiency')),

  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message TEXT,

  -- Computation parameters (for cache invalidation)
  parameters JSONB NOT NULL,
  algorithm_version TEXT NOT NULL,

  -- Results storage
  -- Option A: Store full time series in JSONB (simple, up to ~100MB limit)
  samples JSONB,

  -- Option B: Store in separate table (better for large datasets)
  -- samples_storage_path TEXT, -- Path to JSON file in storage bucket

  -- Summary statistics (always in DB for quick access)
  metadata JSONB NOT NULL,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Ensure one analysis per ride per type
  CONSTRAINT ride_analysis_unique UNIQUE (ride_id, analysis_type)
);

CREATE INDEX idx_ride_analysis_ride_id ON ride_analysis(ride_id);
CREATE INDEX idx_ride_analysis_status ON ride_analysis(status);
CREATE INDEX idx_ride_analysis_type ON ride_analysis(analysis_type);

-- Enable RLS
ALTER TABLE ride_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view analysis for their rides" ON ride_analysis FOR SELECT
TO authenticated USING (
  EXISTS (SELECT 1 FROM rides WHERE rides.id = ride_analysis.ride_id AND rides.user_id = auth.uid())
);

CREATE POLICY "Service role can manage all analysis" ON ride_analysis FOR ALL
TO service_role USING (true) WITH CHECK (true);
```

**Alternative: Extend existing `recording_analysis` table**
```sql
-- recording_analysis already exists for per-recording analysis
-- Could add ride-level analysis to same pattern:

CREATE TABLE ride_analysis (
  -- Same schema as above, following recording_analysis pattern
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
  analysis_type TEXT NOT NULL,
  results JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm_version TEXT,
  parameters JSONB,
  CONSTRAINT ride_analysis_unique UNIQUE (ride_id, analysis_type)
);
```

#### 2. Inngest Job: `calculate-pedaling-efficiency`

**File**: `/src/inngest/functions/calculate-pedaling-efficiency.ts`

```typescript
import { inngest } from '@/inngest/client'
import { createClient } from '@supabase/supabase-js'
import { calculatePedalingEfficiency } from '@/lib/analysis/pedaling-efficiency'
import { fileCache } from '@/lib/cache/file-cache'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ALGORITHM_VERSION = '1.0.0' // Bump when algorithm changes

export const calculatePedalingEfficiencyJob = inngest.createFunction(
  {
    id: 'calculate-pedaling-efficiency',
    retries: 3,
    concurrency: {
      limit: 5, // Limit concurrent computations to avoid memory pressure
    }
  },
  { event: 'ride/associated' },
  async ({ event, step }) => {
    const { rideId, userId } = event.data

    // Step 1: Check if analysis already exists and is up-to-date
    const existingAnalysis = await step.run('check-existing-analysis', async () => {
      const { data } = await supabase
        .from('ride_analysis')
        .select('*')
        .eq('ride_id', rideId)
        .eq('analysis_type', 'pedaling_efficiency')
        .single()

      return data
    })

    if (existingAnalysis?.status === 'completed' &&
        existingAnalysis?.algorithm_version === ALGORITHM_VERSION) {
      return {
        success: true,
        message: 'Analysis already up-to-date',
        rideId,
        analysisId: existingAnalysis.id
      }
    }

    // Step 2: Create or update analysis record with 'processing' status
    const analysisId = await step.run('create-analysis-record', async () => {
      const { data, error } = await supabase
        .from('ride_analysis')
        .upsert({
          ride_id: rideId,
          analysis_type: 'pedaling_efficiency',
          status: 'processing',
          started_at: new Date().toISOString(),
          algorithm_version: ALGORITHM_VERSION,
          parameters: {
            hpfCutoff: 0.5,
            windowSize: 3,
            fftWindowSize: 10,
            confidenceThreshold: 0.15
          }
        }, {
          onConflict: 'ride_id,analysis_type'
        })
        .select('id')
        .single()

      if (error) throw new Error(`Failed to create analysis record: ${error.message}`)
      return data.id
    })

    // Step 3: Fetch ride with recordings
    const rideData = await step.run('fetch-ride-data', async () => {
      const { data: ride, error } = await supabase
        .from('rides')
        .select(`
          id,
          merged_vtx_path,
          ride_recordings (
            recording_id,
            recordings (
              id,
              file_type,
              storage_path,
              start_time,
              end_time
            )
          )
        `)
        .eq('id', rideId)
        .single()

      if (error || !ride) {
        throw new Error(`Failed to fetch ride: ${error?.message || 'Not found'}`)
      }

      return ride
    })

    // Step 4: Validate required recordings
    const validation = await step.run('validate-recordings', async () => {
      const fitRecording = rideData.ride_recordings
        ?.find((rr: any) => rr.recordings?.file_type === 'fit')?.recordings

      const hasVTX = rideData.merged_vtx_path !== null

      if (!fitRecording) {
        throw new Error('No FIT file associated with ride')
      }

      if (!hasVTX) {
        throw new Error('No VTX data associated with ride')
      }

      return { fitRecording, vtxPath: rideData.merged_vtx_path }
    })

    // Step 5: Download and parse files
    const { fitSamples, vtxSamples } = await step.run('download-and-parse-files', async () => {
      // Download FIT file (with caching)
      const fitBuffer = await fileCache.getOrFetch(
        validation.fitRecording.storage_path,
        async () => {
          const { data, error } = await supabase.storage
            .from('recordings')
            .download(validation.fitRecording.storage_path)

          if (error || !data) {
            throw new Error(`Failed to download FIT: ${error?.message}`)
          }

          return await data.arrayBuffer()
        }
      )

      // Download VTX file (merged version, with caching)
      const vtxBuffer = await fileCache.getOrFetch(
        validation.vtxPath,
        async () => {
          const { data, error } = await supabase.storage
            .from('recordings')
            .download(validation.vtxPath)

          if (error || !data) {
            throw new Error(`Failed to download VTX: ${error?.message}`)
          }

          return await data.arrayBuffer()
        }
      )

      // Parse FIT file
      const FitParser = (await import('fit-file-parser')).default
      const fitParser = new FitParser({ force: true })

      const fitData: any = await new Promise((resolve, reject) => {
        fitParser.parse(new Uint8Array(fitBuffer), (error: any, data: any) => {
          if (error) reject(error)
          else resolve(data)
        })
      })

      const fitSamples = fitData.records.map((r: any) => ({
        timestamp: r.timestamp ? new Date(r.timestamp).toISOString() : null,
        grade: r.grade || null,
        altitude: r.enhanced_altitude ?? r.altitude ?? null
      })).filter((s: any) => s.timestamp)

      // Parse VTX file
      const { VTXDecoder } = await import('@vertex-pkg/vtx-parser')
      const decoder = new VTXDecoder(vtxBuffer)
      const header = decoder.getHeader()
      const recordCount = Number(header.recordCount)

      const vtxSamples = []
      for (let i = 0; i < recordCount; i++) {
        const record = decoder.readRecord(i)
        vtxSamples.push({
          timestamp: new Date(record.timestamp).toISOString(),
          accel_x: record.accelX,
          accel_y: record.accelY,
          accel_z: record.accelZ
        })
      }

      return { fitSamples, vtxSamples }
    })

    // Step 6: Run pedaling efficiency calculation
    const results = await step.run('calculate-efficiency', async () => {
      const result = calculatePedalingEfficiency({
        vtxSamples,
        fitSamples,
        options: {
          hpfCutoff: 0.5,
          windowSize: 3,
          fftWindowSize: 10,
          confidenceThreshold: 0.15,
          includeDebug: false // Don't need debug stats for stored results
        }
      })

      return result
    })

    // Step 7: Store results in database
    await step.run('store-results', async () => {
      const { error } = await supabase
        .from('ride_analysis')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          samples: results.samples, // TODO: Consider storage path for large datasets
          metadata: results.metadata
        })
        .eq('id', analysisId)

      if (error) {
        throw new Error(`Failed to store results: ${error.message}`)
      }
    })

    return {
      success: true,
      rideId,
      analysisId,
      sampleCount: results.samples.length,
      avgEfficiency: results.metadata.avgEfficiencyPercent,
      pedalingPercent: results.metadata.pedalingPercent
    }
  }
)

// Error handler
calculatePedalingEfficiencyJob.onFailure(async ({ event, error }) => {
  const { rideId } = event.data.event.data

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  await supabase
    .from('ride_analysis')
    .update({
      status: 'failed',
      error_message: error.message,
      completed_at: new Date().toISOString()
    })
    .eq('ride_id', rideId)
    .eq('analysis_type', 'pedaling_efficiency')
})
```

#### 3. Updated API Endpoint

**File**: `/src/app/api/rides/[id]/pedaling-efficiency/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { withAuth } from '@/lib/api/auth'

export const dynamic = 'force-dynamic'

/**
 * Get precomputed pedaling efficiency analysis for a ride
 *
 * Returns:
 * - If completed: Full time series + metadata
 * - If processing: Processing state with progress (optional)
 * - If pending: Trigger computation and return pending state
 * - If failed: Error details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rideId } = await params

    // Authenticate user
    const authResult = await withAuth(request)
    if ('error' in authResult) return authResult.error

    const { user, supabase } = authResult.data

    // Verify ride ownership
    const { data: ride, error: rideError } = await supabase
      .from('rides')
      .select('id, user_id')
      .eq('id', rideId)
      .eq('user_id', user.id)
      .single()

    if (rideError || !ride) {
      return NextResponse.json(
        { error: 'Ride not found' },
        { status: 404 }
      )
    }

    // Fetch analysis results
    const { data: analysis, error: analysisError } = await supabase
      .from('ride_analysis')
      .select('*')
      .eq('ride_id', rideId)
      .eq('analysis_type', 'pedaling_efficiency')
      .single()

    // No analysis exists - this shouldn't happen if job is working correctly
    if (analysisError || !analysis) {
      return NextResponse.json({
        status: 'not_started',
        message: 'Analysis not yet triggered. Associate recordings to start.',
        samples: [],
        metadata: null
      }, { status: 202 }) // 202 Accepted
    }

    // Analysis is pending or processing
    if (analysis.status === 'pending' || analysis.status === 'processing') {
      return NextResponse.json({
        status: analysis.status,
        message: analysis.status === 'pending'
          ? 'Analysis queued, will start shortly'
          : 'Analysis in progress',
        startedAt: analysis.started_at,
        estimatedCompletion: analysis.started_at
          ? new Date(new Date(analysis.started_at).getTime() + 30000).toISOString() // ~30s estimate
          : null,
        samples: [],
        metadata: null
      }, { status: 202 }) // 202 Accepted
    }

    // Analysis failed
    if (analysis.status === 'failed') {
      return NextResponse.json({
        status: 'failed',
        error: analysis.error_message || 'Analysis failed',
        message: 'Pedaling efficiency calculation failed',
        samples: [],
        metadata: null
      }, { status: 500 })
    }

    // Analysis completed - return cached results
    return NextResponse.json({
      status: 'completed',
      samples: analysis.samples,
      metadata: analysis.metadata,
      computedAt: analysis.completed_at,
      algorithmVersion: analysis.algorithm_version,
      parameters: analysis.parameters
    }, {
      headers: {
        // Cache for 1 hour since results are immutable
        'Cache-Control': 'public, max-age=3600, immutable',
        'ETag': `"${analysis.id}-${analysis.completed_at}"`
      }
    })

  } catch (error: any) {
    console.error('Error fetching pedaling efficiency:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
```

#### 4. Event Trigger

**File**: `/src/app/api/rides/[id]/recordings/route.ts` (existing)

Add event emission after successful ride-recording association:

```typescript
// After creating ride_recordings association
await inngest.send({
  name: 'ride/associated',
  data: {
    rideId: params.id,
    userId: user.id,
    recordingIds: recordingIds
  }
})
```

#### 5. Frontend Updates

**Hook**: `/src/hooks/usePedalingEfficiency.ts`

```typescript
import { useState, useEffect } from 'react'
import { useSession } from '@/contexts/SessionContext'

interface PedalingEfficiencyState {
  status: 'not_started' | 'pending' | 'processing' | 'completed' | 'failed'
  samples: any[]
  metadata: any | null
  error: string | null
  isLoading: boolean
}

export function usePedalingEfficiency(rideId: string) {
  const { session } = useSession()
  const [state, setState] = useState<PedalingEfficiencyState>({
    status: 'not_started',
    samples: [],
    metadata: null,
    error: null,
    isLoading: true
  })

  useEffect(() => {
    let pollingInterval: NodeJS.Timeout | null = null

    const fetchData = async () => {
      try {
        const response = await fetch(`/api/rides/${rideId}/pedaling-efficiency`, {
          headers: {
            'Authorization': `Bearer ${session?.access_token}`
          }
        })

        const data = await response.json()

        setState({
          status: data.status,
          samples: data.samples || [],
          metadata: data.metadata,
          error: data.error || null,
          isLoading: false
        })

        // Poll if processing
        if (data.status === 'pending' || data.status === 'processing') {
          if (!pollingInterval) {
            pollingInterval = setInterval(fetchData, 3000) // Poll every 3s
          }
        } else {
          // Stop polling when completed or failed
          if (pollingInterval) {
            clearInterval(pollingInterval)
            pollingInterval = null
          }
        }

      } catch (error: any) {
        setState(prev => ({
          ...prev,
          error: error.message,
          isLoading: false,
          status: 'failed'
        }))
      }
    }

    fetchData()

    return () => {
      if (pollingInterval) clearInterval(pollingInterval)
    }
  }, [rideId, session])

  return state
}
```

### Data Storage Strategy

**Option A: Store in JSONB column** ✅ RECOMMENDED
- **Pros**:
  - Simple implementation
  - Automatic replication/backup
  - Fast retrieval (single query)
  - Built-in RLS security
- **Cons**:
  - PostgreSQL JSONB has practical limit ~100MB
  - For 30min ride @ 25Hz = ~45k samples × 200 bytes = ~9MB (well within limit)

**Option B: Store in Supabase Storage bucket**
- **Pros**:
  - No size limits
  - Cheaper storage ($0.021/GB vs $0.125/GB for DB)
- **Cons**:
  - More complex (two fetch operations)
  - Need separate caching strategy
  - File lifecycle management

**Recommendation**: Start with Option A (JSONB), migrate to Option B if datasets exceed 50MB.

### Sample Size Estimation

For typical 30-minute mountain bike ride:
- Sample rate: 25 Hz
- Duration: 1800 seconds
- Total samples: 45,000
- Per sample: `{ timestamp, efficiency, confidence, cadence, grade, ... }` ≈ 200 bytes
- **Total size**: ~9MB (fits comfortably in JSONB)

For 2-hour ride:
- Total samples: 180,000
- **Total size**: ~36MB (still fits, but approaching limits)

## Migration Strategy

### Phase 1: Add Infrastructure
1. Create `ride_analysis` table migration
2. Implement Inngest job
3. Add event trigger to ride association endpoint
4. Deploy to staging

### Phase 2: Parallel Operation
1. Keep existing API endpoint functional (fallback to real-time computation)
2. New endpoint checks DB first, falls back to old logic if missing
3. Monitor Inngest job success rate
4. Backfill existing rides (optional)

### Phase 3: Cutover
1. Update API to only serve cached results
2. Remove real-time computation code (~200 LOC)
3. Add UI for processing state (loading spinner, progress)

### Phase 4: Optimization
1. Add HTTP caching headers
2. Add compression for large payloads
3. Consider storage bucket migration if needed

## Performance Impact

### Expected Improvements

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Initial load time | 500-1250ms | 50-150ms | **-80% to -90%** |
| Subsequent loads | 500-1250ms | 10-50ms (cache) | **-95% to -99%** |
| Bandwidth per request | 17-30MB | 0.5-1MB (metadata) | **-95% to -97%** |
| CPU usage per request | High (FFT) | Minimal (DB query) | **-99%** |
| Zoom/pan response | 500-1250ms | 10-50ms | **-95% to -99%** |

### Background Job Performance

- **Computation time**: 500-1250ms (same as current, but asynchronous)
- **Trigger delay**: 0-5s (Inngest queue processing)
- **Total time to completion**: 1-10s after ride association
- **Concurrency**: 5 jobs max (configurable, prevents memory issues)
- **Retry policy**: 3 retries with exponential backoff

## Risks & Mitigations

### Risk 1: Large Dataset Storage
**Issue**: 2+ hour rides could exceed JSONB practical limits (~100MB)

**Mitigation**:
- Phase 1: Store in JSONB (covers 90% of rides)
- Phase 2: Add `samples_storage_path` column, migrate large datasets to storage bucket
- Threshold: Switch to storage if samples > 100k

### Risk 2: Algorithm Changes Invalidate Cache
**Issue**: Updating pedaling efficiency algorithm requires recomputing all rides

**Mitigation**:
- Version field (`algorithm_version`) in database
- Background job checks version, recomputes if outdated
- Admin endpoint to trigger bulk recomputation

### Risk 3: Job Failures Leave Rides in "Processing" State
**Issue**: Failed jobs leave analysis stuck in "processing"

**Mitigation**:
- Inngest automatic retries (3x with backoff)
- `onFailure` handler sets status to "failed"
- UI shows retry button for failed analyses
- Admin dashboard to monitor/retry failed jobs

### Risk 4: Database Size Growth
**Issue**: Storing full time series for every ride increases DB size

**Mitigation**:
- Estimated size: 9MB per 30min ride
- 1000 rides = 9GB (manageable)
- Add retention policy: delete analysis after ride deletion
- Consider data compression (PostgreSQL supports TOAST compression)

### Risk 5: Concurrent Job Memory Pressure
**Issue**: 5 concurrent jobs × 30MB/job = 150MB memory spike

**Mitigation**:
- Inngest concurrency limit set to 5 (configurable)
- File cache limits (1GB max)
- Monitor memory usage, reduce concurrency if needed

## Testing Strategy

### Unit Tests
- [ ] Inngest job successfully computes efficiency
- [ ] Job handles missing FIT file gracefully
- [ ] Job handles missing VTX file gracefully
- [ ] Job stores results correctly
- [ ] Job sets failure state on error
- [ ] Algorithm version checking works

### Integration Tests
- [ ] Event trigger fires on ride association
- [ ] API returns "pending" immediately after association
- [ ] API returns "completed" after job finishes
- [ ] API returns cached results on subsequent requests
- [ ] Polling stops when status becomes "completed"
- [ ] Failed jobs show error message in UI

### Performance Tests
- [ ] Job completes within 10s for 30min ride
- [ ] API response < 100ms for cached results
- [ ] No memory leaks during concurrent jobs
- [ ] Cache hit rate > 95% for completed analyses

### Regression Tests
- [ ] Debug endpoint still works for real-time testing
- [ ] Charts render correctly with new data format
- [ ] Zoom/pan functionality still works
- [ ] Analytics tab loads without errors

## Success Criteria

- [ ] API response time < 100ms for completed analyses (vs 500-1250ms)
- [ ] Background job completes within 10s of ride association
- [ ] Job success rate > 95%
- [ ] Zero UI blocking during computation
- [ ] Codebase reduced by ~200 LOC (removed duplicate logic)
- [ ] Bandwidth reduced by 95%+ for pedaling efficiency requests
- [ ] User can see processing progress in UI

## Open Questions

### 1. Data Storage: JSONB vs Storage Bucket?

**For initial implementation:**
- [ ] Use JSONB for all rides
- [ ] Use JSONB for rides < 2 hours, storage bucket for longer
- [ ] Always use storage bucket for consistency

**Recommendation needed**: Start with JSONB, add storage option later?

### 2. Backfill Existing Rides?

Should we retroactively compute pedaling efficiency for existing rides?

**Options:**
- [ ] Don't backfill, only compute for new associations
- [ ] Backfill on first API request (lazy computation)
- [ ] Backfill all rides in background queue
- [ ] Backfill only rides viewed in last 30 days

**Recommendation needed**: Lazy computation seems best?

### 3. Real-time Computation Fallback?

Should API support real-time computation for:
- Debug endpoint with custom parameters
- Rides missing precomputed results
- Algorithm testing

**Options:**
- [ ] Remove real-time computation entirely (simplest)
- [ ] Keep debug endpoint with real-time computation
- [ ] Add `?force_recompute=true` query parameter

**Recommendation needed**: Keep debug endpoint only?

### 4. Processing Progress Updates?

Should we show % completion during processing?

**Options:**
- [ ] Simple states only (pending → processing → completed)
- [ ] Add progress % (requires step.sendEvent updates from job)
- [ ] Add estimated time remaining

**Recommendation needed**: Simple states sufficient? Progress adds complexity.

### 5. Downsampling for API Response?

Should we downsample results before returning to reduce payload size?

**Current**: 45k samples × 200 bytes = 9MB payload
**Downsampled**: 2k samples × 200 bytes = 400KB payload (95% smaller)

**Options:**
- [ ] Always return full resolution (let client downsample)
- [ ] Add `?resolution=` parameter (like VTX endpoint)
- [ ] Store both full + downsampled versions

**Recommendation needed**: Add resolution parameter for consistency?

### 6. Trigger Timing?

When should we trigger the computation job?

**Options:**
- [ ] Immediately on ride-recording association
- [ ] After VTX merge completes (depends on merged file)
- [ ] On first API request (lazy)
- [ ] Manual trigger from UI

**Recommendation needed**: After VTX merge? Ensures merged file exists.

### 7. Cache Invalidation Strategy?

What happens when algorithm is updated?

**Options:**
- [ ] Bump version, recompute on next request (lazy)
- [ ] Bump version, queue all rides for recomputation (eager)
- [ ] Manual per-ride recomputation from admin panel
- [ ] Keep old versions, allow API to specify version

**Recommendation needed**: Lazy recomputation sufficient?

### 8. Error Recovery UX?

How should users retry failed computations?

**Options:**
- [ ] Automatic retry (Inngest handles this)
- [ ] Show "Retry" button in UI
- [ ] Auto-retry on next page visit
- [ ] Admin-only manual retry

**Recommendation needed**: Auto-retry + admin panel?

### 9. Debug Endpoint Preservation?

The `/pedaling-efficiency/debug` endpoint is useful for algorithm development.

**Options:**
- [ ] Keep debug endpoint with real-time computation
- [ ] Remove debug endpoint, use stored data only
- [ ] Add debug mode to background job (store extra stats)

**Recommendation needed**: Keep debug endpoint for development?

### 10. Metadata-Only Endpoint?

Should we add a lightweight endpoint for just summary stats?

**Use case**: Analytics dashboard showing efficiency across all rides

**Options:**
- [ ] Main endpoint returns full data, client filters
- [ ] Add `/pedaling-efficiency/summary` endpoint
- [ ] Add `?fields=metadata` parameter

**Recommendation needed**: Separate summary endpoint needed?

## Future Enhancements

### Phase 2 Optimizations (Post-MVP)
- Add data compression (gzip JSONB)
- Migrate large datasets (>100k samples) to storage bucket
- Add downsampling parameter to API
- Pre-compute multiple resolutions
- Add GraphQL endpoint for flexible queries

### Phase 3 Analytics (Future RFC)
- Aggregate pedaling efficiency across rides
- Track improvement over time
- Compare efficiency by terrain type
- Detect patterns (e.g., fatigue correlation)

### Phase 4 Real-time Preview (Future RFC)
- Stream partial results during computation
- Show progress in UI
- Allow cancellation of long-running jobs

## References

- [RFC 003: Ride Data API Optimization](./003-ride-data-api-optimization.md) - VTX merging pattern
- [Inngest Documentation](https://www.inngest.com/docs)
- [PostgreSQL JSONB Performance](https://www.postgresql.org/docs/current/datatype-json.html)
- Current implementation: `/app/api/rides/[id]/pedaling-efficiency/route.ts`
- Analysis algorithm: `/lib/analysis/pedaling-efficiency.ts`

## Appendix: Files to Create/Modify

### New Files (4)
- `/migrations/005_ride_analysis_table.sql` - Database schema
- `/src/inngest/functions/calculate-pedaling-efficiency.ts` - Background job (~250 LOC)
- `/src/hooks/usePedalingEfficiency.ts` - React hook (~80 LOC)
- `/docs/rfcs/005-pedaling-efficiency-background-processing.md` - This document

### Modified Files (4)
- `/src/app/api/rides/[id]/pedaling-efficiency/route.ts` - API endpoint (rewrite, ~150 LOC → ~80 LOC)
- `/src/app/api/rides/[id]/recordings/route.ts` - Add event trigger (~5 LOC added)
- `/src/app/api/inngest/route.ts` - Register new function (~1 LOC added)
- `/src/components/analytics/PedalingEfficiencyChart.tsx` - Update to use new hook (~20 LOC changed)

### Deleted/Obsolete (after migration)
- Duplicate FIT parsing logic in pedaling efficiency endpoint (~60 LOC removed)

### Total LOC Change
- **Added**: ~330 LOC (job + hook + migration)
- **Removed**: ~130 LOC (duplicate logic)
- **Net**: +200 LOC (mostly infrastructure, reusable)

## Decision

**Status**: ✅ APPROVED - Phase 1 in progress

**Decisions Made**:
1. ✅ **Data Storage**: JSONB in database (covers 90%+ of rides)
2. ✅ **Backfill**: Lazy computation on first API request
3. ✅ **Real-time Fallback**: Keep debug endpoint only
4. ✅ **Progress**: Simple states (pending/processing/completed) - no % updates
5. ✅ **Downsampling**: Add `?resolution=` parameter for consistency with VTX endpoint
6. ✅ **Trigger Timing**: After VTX merge completes (ensures merged file exists)
7. ✅ **Cache Invalidation**: Lazy recomputation on version bump
8. ✅ **Error Recovery**: Automatic retry via Inngest + admin panel for manual retry
9. ✅ **Debug Endpoint**: Keep for algorithm development
10. ✅ **Metadata Endpoint**: Add `?fields=metadata` parameter (consistent with VTX pattern)

**Implementation Plan**:
1. ✅ Schema approved - remove unused `recording_analysis` table
2. 🔄 Phase 1: Infrastructure (in progress)
   - Create `ride_analysis` table migration
   - Implement Inngest job
   - Update API endpoint
   - Add event trigger
3. ⏳ Phase 2: Testing and deployment
4. ⏳ Phase 3: Monitoring and optimization
