# RFC 008: Pedaling Efficiency Heatmap Overlay on GPS Route

**Status:** Draft
**Author:** Claude
**Date:** 2026-02-05
**Affects:** RideMap component, analytics tab, pedaling efficiency visualization

## Summary

Add a gradient heatmap overlay to the GPS route polyline that visualizes pedaling efficiency values (0-100%) with color mapping: red (poor, 0-30%) → yellow (moderate, 30-70%) → green (excellent, 70-100%). The overlay activates when the user switches to the 'analytics' data tab.

## Motivation

**Current state**:
- GPS map shows VTX coverage (green = has IMU data, white/black = no IMU)
- Pedaling efficiency data displayed only in time-series chart
- No spatial visualization of where efficiency is good/poor on the route

**Desired state**:
- When viewing analytics tab, map shows efficiency heatmap instead of coverage
- Users can see which segments (hills, flats, technical sections) have good/poor efficiency
- Provides spatial context for efficiency patterns

## Proposed Solution

### Architecture

```
┌──────────────────────────────────────────┐
│ RideVisualizationsClient                 │
│ ┌────────────────────────────────────┐   │
│ │ RideDataTabs (activeTab state)     │   │
│ │  - 'imu' → VTX coverage overlay    │   │
│ │  - 'analytics' → Efficiency overlay│   │
│ └─────────────────┬──────────────────┘   │
│                   │ (tab change)          │
│                   ▼                       │
│ ┌────────────────────────────────────┐   │
│ │ RideMapClient                      │   │
│ │  mapMode={activeTab === 'analytics'│   │
│ │           ? 'efficiency' : 'vtx'}  │   │
│ │  efficiencySamples={cached data}   │   │
│ └─────────────────┬──────────────────┘   │
│                   ▼                       │
│ ┌────────────────────────────────────┐   │
│ │ RideMap (new overlay logic)        │   │
│ │  - If mapMode === 'vtx':           │   │
│ │    Color by VTX coverage           │   │
│ │  - If mapMode === 'efficiency':    │   │
│ │    Color by efficiency gradient    │   │
│ └────────────────────────────────────┘   │
└──────────────────────────────────────────┘
```

### Component Changes

#### 1. `RideVisualizationsClient` (orchestrator)

**State additions:**
```typescript
// Track active data tab to determine map overlay mode
const [activeDataTab, setActiveDataTab] = useState<'imu' | 'analytics'>('imu')

// Fetch and cache pedaling efficiency data (always available)
const {
  samples: efficiencySamples,
  loading: efficiencyLoading
} = useDerivedMetric({
  rideId,
  metric: 'pedalingEfficiency',
  timeRange: null, // Always fetch full ride for map
  fitRecordingId
})
```

**Pass to RideMapClient:**
```typescript
<RideMapClient
  samples={samples}
  imuTimeRanges={imuTimeRanges}
  highlightIndex={highlightIndex}
  mapMode={activeDataTab === 'analytics' ? 'efficiency' : 'vtx'}
  efficiencySamples={efficiencySamples}
/>
```

**Pass to RideDataTabs:**
```typescript
<RideDataTabs
  onTabChange={setActiveDataTab} // NEW callback
  // ... existing props
/>
```

#### 2. `RideDataTabs` Component

**Add callback prop:**
```typescript
interface RideDataTabsProps {
  // ... existing props
  onTabChange?: (tab: 'imu' | 'analytics') => void // NEW
}

const handleTabChange = (tab: 'imu' | 'analytics') => {
  if (tab === activeTab) return
  setIsTransitioning(true)
  setActiveTab(tab)
  onTabChange?.(tab) // Notify parent
  setTimeout(() => setIsTransitioning(false), 100)
}
```

#### 3. `RideMapClient` Component

**New props:**
```typescript
interface RideMapClientProps {
  // ... existing props
  mapMode?: 'vtx' | 'efficiency' // NEW
  efficiencySamples?: Array<{ timestamp: string; value: number }> // NEW
}
```

**Pass to RideMap:**
```typescript
<RideMap
  gpsTrack={gpsTrack}
  imuTimeRanges={mapMode === 'vtx' ? imuTimeRanges : []}
  efficiencySamples={mapMode === 'efficiency' ? efficiencySamples : undefined}
  // ... existing props
/>
```

#### 4. `RideMap` Component (core changes)

**New props:**
```typescript
interface RideMapProps {
  // ... existing props
  efficiencySamples?: Array<{ timestamp: string; value: number }>
}
```

**Polyline coloring logic:**
```typescript
const getPointColor = useCallback((point: GPSPoint): string => {
  // Mode 1: VTX coverage overlay (existing)
  if (!efficiencySamples && imuTimeRanges.length > 0) {
    const pointTime = new Date(point.timestamp).getTime()
    const hasIMU = imuTimeRanges.some(range =>
      pointTime >= range.start && pointTime <= range.end
    )
    return hasIMU ? imuRouteColor : defaultRouteColor
  }

  // Mode 2: Pedaling efficiency heatmap overlay (NEW)
  if (efficiencySamples && efficiencySamples.length > 0) {
    const efficiencyValue = findClosestEfficiency(point.timestamp, efficiencySamples)
    if (efficiencyValue === null) return defaultRouteColor
    return getEfficiencyColor(efficiencyValue)
  }

  // Default: no overlay
  return defaultRouteColor
}, [efficiencySamples, imuTimeRanges, imuRouteColor, defaultRouteColor])
```

**Helper: Find closest efficiency value by timestamp:**
```typescript
const findClosestEfficiency = (
  timestamp: string,
  samples: Array<{ timestamp: string; value: number }>
): number | null => {
  // Use existing sync utility
  const result = findClosestByTime(samples, new Date(timestamp).getTime() / 1000)
  return result ? result.item.value : null
}
```

**Helper: Map efficiency to color:**
```typescript
const getEfficiencyColor = (efficiency: number): string => {
  // efficiency is 0-100%
  if (efficiency < 30) {
    // Poor (0-30%): Red (#ef4444) to Orange (#f97316)
    const t = efficiency / 30
    return interpolateColor('#ef4444', '#f97316', t)
  } else if (efficiency < 70) {
    // Moderate (30-70%): Orange to Yellow (#eab308)
    const t = (efficiency - 30) / 40
    return interpolateColor('#f97316', '#eab308', t)
  } else {
    // Excellent (70-100%): Yellow to Green (#22c55e)
    const t = (efficiency - 70) / 30
    return interpolateColor('#eab308', '#22c55e', t)
  }
}

const interpolateColor = (color1: string, color2: string, t: number): string => {
  const r1 = parseInt(color1.slice(1, 3), 16)
  const g1 = parseInt(color1.slice(3, 5), 16)
  const b1 = parseInt(color1.slice(5, 7), 16)
  const r2 = parseInt(color2.slice(1, 3), 16)
  const g2 = parseInt(color2.slice(3, 5), 16)
  const b2 = parseInt(color2.slice(5, 7), 16)

  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)

  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}
```

**Segment rendering:**
```typescript
// Existing segment logic, but use getPointColor() for each point
const segments = useMemo(() => {
  const result: Array<{ points: LatLngExpression[], color: string }> = []
  let currentSegment: LatLngExpression[] = []
  let currentColor = getPointColor(simplifiedTrack[0])

  simplifiedTrack.forEach((point, idx) => {
    const pointColor = getPointColor(point)

    if (pointColor !== currentColor && currentSegment.length > 0) {
      // Color changed, save segment and start new one
      result.push({ points: [...currentSegment], color: currentColor })
      currentSegment = [currentSegment[currentSegment.length - 1]] // Start new with last point
      currentColor = pointColor
    }

    currentSegment.push([point.lat, point.lon])
  })

  if (currentSegment.length > 0) {
    result.push({ points: currentSegment, color: currentColor })
  }

  return result
}, [simplifiedTrack, getPointColor])
```

### Data Flow

1. **User switches to Analytics tab**
   - `RideDataTabs` calls `onTabChange('analytics')`
   - Parent updates `activeDataTab` state
   - `RideMapClient` receives `mapMode='efficiency'`

2. **Map re-renders with efficiency overlay**
   - `RideMap` uses `efficiencySamples` instead of `imuTimeRanges`
   - Each GPS point matched to closest efficiency sample by timestamp
   - Polyline segments colored using efficiency gradient

3. **User switches back to IMU tab**
   - Same flow, but `mapMode='vtx'`
   - Map reverts to VTX coverage overlay

### UI/UX Enhancements (Optional)

**Legend:**
```typescript
{mapMode === 'efficiency' && (
  <div className="absolute bottom-4 left-4 bg-card p-3 rounded-lg shadow-lg">
    <p className="text-xs font-semibold mb-2">Pedaling Efficiency</p>
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 bg-[#ef4444] rounded"></div>
      <span className="text-xs">Poor (0-30%)</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 bg-[#eab308] rounded"></div>
      <span className="text-xs">Moderate (30-70%)</span>
    </div>
    <div className="flex items-center gap-2">
      <div className="w-4 h-4 bg-[#22c55e] rounded"></div>
      <span className="text-xs">Excellent (70-100%)</span>
    </div>
  </div>
)}
```

**Hover popup enhancement:**
```typescript
// In existing hover marker logic
{hoverIndex !== null && (
  <Popup>
    <div>
      {/* Existing speed/altitude */}
      {efficiencySamples && (
        <p>Efficiency: {efficiency.toFixed(1)}%</p>
      )}
    </div>
  </Popup>
)}
```

## Performance Considerations

**Data volume:**
- Pedaling efficiency samples: ~1000 points (downsampled full ride) for map overlay
- GPS samples: ~1000-3000 points (Douglas-Peucker simplified)
- Efficiency lookup: O(log n) with binary search (or use existing `findClosestByTime`)

**Caching:**
- Efficiency data already cached via `useDerivedMetric` (RFC 005)
- API returns precomputed results (~50ms response time)
- Map re-renders only when `mapMode` or data changes

**Optimization opportunities:**
- Pre-join GPS + efficiency samples on mount (avoid per-point lookup)
- Memoize color calculations
- Limit segment count for very long routes (existing Douglas-Peucker handles this)

## Open Questions

### 1. **Color Gradient Scheme**

Should we use a different color mapping?

**Option A (proposed)**: Red → Orange → Yellow → Green
- Clear "bad to good" visual metaphor
- Matches common heatmap conventions

**Option B**: Blue → Yellow → Red
- Scientific heatmap standard
- But blue often implies "cold/inactive" which doesn't fit efficiency

**Option C**: Grayscale with green highlights
- Lower cognitive load
- Green only for excellent efficiency (>70%)

Use A. Also should include a gradient between data/no data that fades to the default line color

### 2. **Data Source**

Which efficiency samples should we use for the map?

**Option A**: Full ride downsampled (~1000 points)
- Already cached from API
- Fast, no additional fetch
- Lower resolution but sufficient for route visualization

**Option B**: Native resolution (25Hz, ~45k samples)
- Maximum detail
- Requires `?resolution=full` API call
- Slower, larger payload (~9MB)

Use A.

### 3. **Tab Switching Behavior**

How should the map update when switching tabs?

**Option A**: Instant switch (proposed)
- Map re-renders immediately with new overlay
- Simple, responsive

**Option B**: Fade transition
- Crossfade between VTX and efficiency overlays
- Smoother but more complex

A, instant

### 4. **Missing Efficiency Data**

What should map show when efficiency data is not available?

**Scenarios:**
- Ride has no FIT file (grade data required for efficiency)
- Efficiency calculation failed
- Efficiency still processing

**Options:**
- Fall back to VTX coverage overlay
- Show gray/default route color
- Display "Efficiency unavailable" message

Show default color, detect gaps over 10s (like the chart), gradient from last known value to default

### 5. **Zoom Behavior**

Should zoomed efficiency data be higher resolution?

**Current**: When user zooms chart, API returns higher-res efficiency data for that range
**Question**: Should map also request higher-res efficiency when zoomed?

**Option A**: Always use full-ride downsampled data (~1000 points)
- Consistent map appearance
- No additional fetches

**Option B**: Request higher-res efficiency when chart is zoomed
- More accurate efficiency values on zoomed map
- Requires syncing zoom state to map

Always use full ride, I'll determine if higher resolution needed later

### 6. **Gradient Granularity**

How many color steps should the gradient use?

**Option A**: Continuous gradient (256 colors)
- Smooth, visually pleasing
- Harder to perceive exact values

**Option B**: Discrete bins (e.g., 10 colors)
- Easier to read
- Legend shows exact ranges

**Option C**: 3 broad categories (poor/moderate/excellent)
- Simplest
- Loses nuance

Continuous

### 7. **Efficiency Value Display**

When user hovers over a route segment, what should the popup show?

**Option A**: Just efficiency percentage
```
Efficiency: 65%
```

**Option B**: Efficiency + context
```
Efficiency: 65% (Moderate)
Detected cadence: 72 RPM
```

**Option C**: No popup (use legend only)
- Cleaner map
- Relies on color interpretation

Ideally be, do we already have context data associated/fetched?

### 8. **Alternative Visualization**

Should we support other map overlay modes in the future?

**Possible overlays:**
- Power output heatmap (if FIT has power data)
- Heart rate heatmap
- Speed heatmap
- Cadence heatmap
- Cornering score (future metric)

**Architecture question**: Should we generalize `mapMode` now or add it later?

**Option A**: Keep it simple (`'vtx' | 'efficiency'` for now)
**Option B**: Design for extensibility (`mapMode: 'vtx' | HeatmapConfig`)

Keep it simple for now, we will add more in the future, so make sure it's extensible

## Implementation Plan

### Phase 1: Data Fetching
1. Modify `RideVisualizationsClient` to always fetch pedaling efficiency (cached)
2. Add `activeDataTab` state tracking
3. Pass `onTabChange` callback to `RideDataTabs`

### Phase 2: Map Component Updates
1. Add `mapMode` and `efficiencySamples` props to `RideMapClient` and `RideMap`
2. Implement `getEfficiencyColor()` gradient function
3. Update segment coloring logic to use `getPointColor()` helper

### Phase 3: Testing & Refinement
1. Test tab switching performance
2. Verify color gradient readability
3. Test with missing efficiency data
4. Add legend (optional)
5. Test on long rides (2+ hours)

### Phase 4: Polish (Optional)
1. Add hover popup showing efficiency value
2. Add color legend
3. Add loading state while efficiency data fetches
4. Handle edge cases (no FIT file, failed analysis)

## Success Criteria

- [ ] Switching to Analytics tab shows efficiency gradient on map
- [ ] Gradient colors accurately reflect efficiency values (0-100%)
- [ ] No performance degradation (map renders smoothly)
- [ ] Fallback behavior works when efficiency unavailable
- [ ] Switching back to IMU tab restores VTX coverage overlay

## Risks & Mitigations

**Risk 1: GPS/efficiency sample mismatch**
- GPS samples at ~1Hz (from FIT file)
- Efficiency samples at 25Hz (from VTX/FIT merge)
- **Mitigation**: Use `findClosestByTime()` with tolerance window

**Risk 2: Color perception issues**
- Red-green colorblindness affects ~8% of males
- **Mitigation**: Consider adding optional colorblind-safe palette (future)

**Risk 3: Map clutter with legend**
- Legend may obscure route on mobile
- **Mitigation**: Make legend collapsible or show on hover only

## Future Enhancements

- Add colorblind-safe palette option
- Support other heatmap overlays (power, HR, speed)
- Allow user to customize gradient thresholds
- Add segment click → jump to that time in chart
- Export heatmap as image

## References

- [RFC 005: Pedaling Efficiency Background Processing](./005-pedaling-efficiency-background-processing.md)
- Current implementation: `/src/components/ride-map.tsx`
- Sync utilities: `/src/lib/sync/fit-vtx-sync.ts`
- Data hook: `/src/components/charts/hooks/useDerivedMetric.ts`
