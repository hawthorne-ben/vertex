# RFC 007: Chart Zoom with Server-Side Resolution Management

**Status:** Approved
**Author:** Claude
**Date:** 2026-02-03
**Affects:** Chart components, IMU/VTX API endpoints, zoom behavior

## Summary

Refactor chart zoom implementation to fetch only the selected time range from the API with server-determined resolution, while using coverage data to render gaps outside the visible data range.

## Motivation

### Current Problems

1. **Thrashing**: Chart flashes between zoomed/not-zoomed states on every zoom action
2. **Poor resolution on zoom**: Always fetching full dataset with fixed downsampling (1000-2000 points) means zoomed views lack detail
3. **Unnecessary data transfer**: Fetching full ride data when user only needs 5-minute segment
4. **Client-side resolution logic**: Resolution management scattered across React hooks

### Example Flow (Current)

```
User zooms to 5-minute segment
→ Client fetches full 2-hour ride (20MB, downsampled to 2000 points)
→ Client filters to 5-minute segment in memory
→ Result: 5 minutes of data at 2000 points / 120 minutes = ~83 points (insufficient resolution)
```

## Proposed Solution

### High-Level Flow

1. User drags to select zoom range → `onZoom` callback fires
2. Parent component saves zoom range to state (no immediate chart update)
3. Hook detects zoom range change → fetches ONLY selected range from API
4. API determines optimal resolution based on time range duration and 25Hz sample rate
5. API returns `{ samples: [...], coverage: [...] }` (coverage always includes full ride)
6. Chart renders zoomed samples + uses coverage to show gaps on either side

### API Changes

#### `/api/rides/[id]/vtx-samples`

**Remove parameter:**
- `resolution: number` (client-controlled)

**Add parameters:**
- `start: string` (ISO timestamp, optional)
- `end: string` (ISO timestamp, optional)

**Server-side resolution logic:**

```typescript
if (!start || !end) {
  // Full ride overview: ~1000 samples
  const targetResolution = 1000
  return downsample(allSamples, targetResolution)
}

// Zoomed view: calculate based on duration
const durationSeconds = (new Date(end) - new Date(start)) / 1000
const totalSamplesInRange = durationSeconds * 25 // 25Hz sample rate
const targetResolution = Math.min(totalSamplesInRange, 5000) // cap at 5k
return downsample(samplesInRange, targetResolution)
```

**Response format** (unchanged):

```typescript
{
  samples: IMUSample[],
  metadata: { total_samples: number, ... },
  coverage: Array<{ start: number, end: number }> // ALWAYS full ride coverage
}
```

### Client Changes

#### `useIMUData` Hook

**Remove:**
- All resolution logic/parameters
- Manual scale setting in UPlotBase

**New behavior:**

```typescript
useEffect(() => {
  const params = new URLSearchParams()
  params.set('downsample', 'lttb')

  // If zoomed, fetch only selected range
  if (timeRange) {
    params.set('start', timeRange.start)
    params.set('end', timeRange.end)
  }
  // Otherwise fetch full ride (API auto-downsamples to ~1000 points)

  const { samples, coverage } = await fetch(`/api/rides/${rideId}/vtx-samples?${params}`)

  setSamples(samples)
  setCoverageRanges(coverage) // Always full ride coverage
}, [rideId, recordingIds, dataType, timeRange]) // timeRange SHOULD trigger refetch
```

#### `UPlotBase` Component

**Remove:**
- Manual `setScale` logic for zoom
- `zoomRange` prop (no longer needed)

**New behavior:**
- Chart renders whatever data it receives (naturally shows zoomed view)
- Coverage ranges used for gap rendering (optional enhancement)

### Component Updates

#### `IMUSensorChart`
- Remove `zoomRange` prop passing to UPlotBase
- Chart naturally shows zoomed data when it arrives

#### `DerivedMetricsChart`
- Same changes as IMUSensorChart
- Pedaling efficiency API implements same resolution logic

## Benefits

1. **No thrashing**: Chart only updates when new data arrives
2. **Better resolution on zoom**: Fetching specific range allows up to 5000 samples for that segment
3. **Less bandwidth**: Full ride = 1000 points, zoomed = actual range at higher resolution
4. **Simpler client code**: No resolution management, no manual scale setting
5. **Gap visibility preserved**: Coverage data ensures gaps always visible

## Edge Cases

- **Zoom wider than data**: Coverage shows gaps, samples sparse in those regions
- **Very short zoom**: API caps at 5k points for performance
- **Multiple VTX files**: Coverage already handles this (from existing gap detection)
- **Double-click reset**: Clears zoomRange state, triggers refetch of full ride at low resolution

## Implementation

### Phase 1: API Updates

1. Update `/api/rides/[id]/vtx-samples` to accept `start`/`end` params
2. Implement server-side resolution logic
3. Ensure coverage always returns full ride ranges

### Phase 2: Client Updates

1. Remove resolution params from `useIMUData`
2. Add `timeRange` to dependency array (allow refetch on zoom)
3. Remove `setScale` zoom logic from `UPlotBase`
4. Update `DerivedMetricsChart` with same pattern

### Phase 3: Testing

- Verify zoom triggers refetch with appropriate resolution
- Verify full view loads with ~1000 points
- Verify zoomed view loads with higher resolution
- Verify gaps render correctly on zoom boundaries

## Expected Performance

| Scenario | Data Transferred | Resolution |
|----------|------------------|-----------|
| Full ride view | ~1000 points | Low |
| Zoom to 5 min (25Hz ride) | ~5000 points | High |
| Zoom to 30 sec | ~750 points | Native |

## Decision

**APPROVED** - Implement in phases, starting with API updates.
