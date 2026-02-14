# RFC 010: Riding Position Detection

**Status:** Draft
**Created:** 2026-02-12
**Author:** Claude

## Summary

Add riding position detection (standing vs. seated) as a new derived metric, computed from VTX accelerometer data and stored alongside pedaling efficiency.

## Motivation

Riders want to understand their standing/seated distribution to:
- Analyze climbing technique (standing on steep grades)
- Track endurance pacing (excessive standing = fatigue)
- Compare road vs. MTB riding styles

## Design

### Detection Algorithm

Reuse pedaling detection infrastructure (shared with efficiency) with Y-axis rocking analysis:

**Standing Indicators:**
- Y-axis (lateral rocking) magnitude > threshold (default: 0.8 m/s²)
- High variance in Y-axis signal
- Pedaling detected (confidence > threshold)

**Seated Indicators:**
- Y-axis magnitude < threshold
- Low-medium variance in Y-axis signal
- Pedaling detected

**Not Pedaling:**
- Confidence below threshold (shared with efficiency)
- Returns `null` (gaps match efficiency gaps exactly)

### Data Model

```typescript
interface RidingPositionSample {
  timestamp: string
  position: 'standing' | 'seated' | null  // null when not pedaling
  confidence: number  // Shared pedaling detection confidence
  rockingMagnitude: number  // Y-axis oscillation
  detectedCadence: number | null
}
```

Stored in `ride_analysis` table:
- `analysis_type`: `'riding_position'`
- `samples`: JSONB array (downsampled to 1 Hz)
- `metadata`: Standing %, seated %, avg cadence by position

### Computation Flow

1. **Single Inngest job** computes both efficiency AND position
2. **Shared pedaling detection** (FFT, confidence) runs once at 25 Hz
3. **Efficiency:** Calculated from acceleration std dev, downsampled to 1 Hz
4. **Position:** Calculated from Y-axis rocking, downsampled to 1 Hz (majority vote)
5. **Store both analyses** to `ride_analysis` table in single transaction

### Shared Abstractions

Extract to `/src/lib/analysis/shared/`:
- `signal-processing.ts` - HPF, FFT, windowing
- `pedaling-detection.ts` - Cadence, confidence thresholds
- `sample-aggregation.ts` - Bucketing, majority vote, averaging

### UI Integration

**Derived Metrics Dropdown:**
- Pedaling Efficiency (existing)
- Riding Position (new)

**Chart:** Horizontal bar chart showing seated (green) vs. standing (orange) blocks over time

**Map Overlay:**
- Shows ONLY the selected metric from dropdown
- Riding Position: green (seated), orange (standing)
- Efficiency: existing color gradient

**Dev Tuning Modal:**
- Add Y-axis threshold slider
- Add standing detection parameters
- Recompute and save on demand (same pattern as efficiency)

## Implementation

### Phase 1: Refactor Existing Job
1. Rename `calculate-pedaling-efficiency` → `calculate-ride-analytics`
2. Refactor to compute BOTH metrics in single pass:
   - Run pedaling detection once (FFT, confidence)
   - Calculate efficiency from acceleration std dev
   - Calculate position from Y-axis rocking
   - Downsample both to 1 Hz
   - Save both to `ride_analysis` table
3. Extract shared logic to `/src/lib/analysis/shared/`
   - `signal-processing.ts` - HPF, FFT, windowing
   - `pedaling-detection.ts` - Cadence, confidence
   - `sample-aggregation.ts` - Bucketing, downsampling

### Phase 2: Position Detection Logic
4. Create `/src/lib/analysis/riding-position.ts`
5. Add constants to existing `pedaling-efficiency-constants.ts`:
   - `Y_AXIS_STANDING_THRESHOLD = 0.8` m/s²
   - `POSITION_WINDOW_SECONDS = 3`
6. Update efficiency calculation to return position data too

### Phase 3: API & UI
7. Add API endpoint `/api/rides/[id]/riding-position`
8. Add recompute endpoint `/api/rides/[id]/riding-position/recompute` (dev-only)
9. Update `useDerivedMetric` hook to support `ridingPosition` metric
10. Update `DerivedMetricsChart` to render bar chart for position data
11. Add "Riding Position" option to metric selector dropdown
12. Update map overlay to switch based on selected metric
13. Extend dev tuning modal to include position parameters

## Design Decisions

- **Single Inngest job:** One job computes both metrics (avoid duplicate pedaling detection)
- **Y-axis threshold:** 0.8 m/s² (reasonable default, tunable via dev modal)
- **Computation independence:** Position computes even if grade data missing (efficiency may fail)
- **Gap parity:** Both metrics use same pedaling detection, so gaps match exactly
- **Map overlay:** Single metric at a time (dropdown selection controls map)
- **Downsampling:** Compute at 25 Hz, store only 1 Hz (efficiency: avg, position: majority vote)
- **Dev tools:** Full tuning support like efficiency (recompute + save both metrics)
- **Atomic storage:** Both analyses saved in single transaction for consistency

## Alternatives Considered

- **"Pedaling Position"** - Too narrow, riding is broader term
- **Display both metrics on map** - Too cluttered, confusing
- **Store 25 Hz data** - Unnecessary storage overhead
- **Real-time ML** - Premature optimization
