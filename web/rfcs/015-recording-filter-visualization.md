# RFC 015: Recording Filter Visualization

**Status:** Draft
**Date:** 2026-04-17
**Author:** Claude
**Affects:** Recording detail page, IMUSensorChart, signal-processing.ts

## Summary

Add an interactive filter workbench to the recording detail page. Users configure LPF, HPF, or BPF filters with a cutoff frequency, apply them to any combination of accel/gyro axes, and view the filtered output alongside (or instead of) the raw signal in the existing chart. Computed streams are ephemeral (client-side only, no persistence) but survive zoom, axis toggling, and data-type switching within the session.

## Motivation

The analysis pipeline applies several filters before deriving metrics:
- 5 Hz Butterworth LPF on accel for braking pitch extraction
- 0.3-10 Hz BPF on gyro for pedal stability
- 0.5 Hz HPF on accel for roughness
- 0.5-4 Hz BPF on gyro for riding position

These filters are critical — they determine what the downstream algorithms see. But there's no way to visually verify what a filter does to the actual signal on a real recording. Tuning filter parameters (cutoff, type) currently requires modifying constants, recomputing the full pipeline (58s), and comparing chart output that's been further processed by windowing and thresholding.

A filter visualization tool lets you:
- Sanity-check that a filter cutoff is removing what you expect and preserving what you need
- Compare LPF at 1 Hz vs 5 Hz on the same data to see what the braking algorithm "sees"
- Spot issues like road chatter leaking through, or braking events getting attenuated
- Prototype new filter configurations before committing them to the pipeline

## Design

### User Experience

On the recording detail page, a collapsible "Filter Workbench" panel appears below the data type selector. The workflow:

1. **Configure a filter**: Pick a type (LPF / HPF / BPF), set cutoff(s) in Hz, and select which axes to apply it to (e.g., accel X+Z, or gyro all, or just accel Y).

2. **Compute**: Click "Apply" — the filter runs client-side on the currently loaded samples. A computed stream is added to the chart as additional series (e.g., "X (LPF 5Hz)" alongside the raw "X").

3. **View & compare**: The chart now shows both raw and filtered signals. The user can use the existing legend toggles to show/hide individual series. Zoom and scrub work normally — the filtered data is recomputed on the visible samples when zoom changes.

4. **Iterate**: The user can modify the filter config and re-apply, or add additional filter configs to compare (e.g., LPF 1Hz vs LPF 5Hz on the same axis). Each produces its own set of series.

5. **Clear**: A "Clear Filters" button removes all computed streams, returning to raw data only.

### Architecture

```
RecordingChartClient
  └─ FilterWorkbench (new)              ← config UI, manages filter definitions
  └─ IMUSensorChart
       └─ useIMUData                     ← fetches raw samples (unchanged)
       └─ useFilteredStreams (new)        ← applies filters client-side
       └─ processIMUChartData            ← builds chart config
       └─ UPlotBase                      ← renders chart
```

#### Filter Definition

```typescript
interface FilterDefinition {
  id: string                          // unique ID for keying
  type: 'lpf' | 'hpf' | 'bpf'
  cutoffHz: number                    // for LPF/HPF
  cutoffLowHz?: number                // for BPF lower bound
  cutoffHighHz?: number               // for BPF upper bound
  phase: 'zero' | 'causal'           // zero-phase (filtfilt) or causal (forward-only)
  axes: FilterAxis[]                  // which axes to apply to
  color?: string                      // optional override; auto-assigned if omitted
}

type FilterAxis =
  | 'accel_x' | 'accel_y' | 'accel_z'
  | 'gyro_x' | 'gyro_y' | 'gyro_z'
```

#### Computed Stream

A `FilterDefinition` applied to the current samples produces one series per selected axis:

```typescript
interface FilteredStream {
  filterId: string
  axis: FilterAxis
  label: string                       // e.g. "X (LPF 5Hz)"
  color: string
  values: (number | null)[]           // parallel to raw samples array
}
```

#### useFilteredStreams Hook

```typescript
function useFilteredStreams(
  samples: IMUSample[],
  filters: FilterDefinition[],
  sampleRate: number,
): FilteredStream[]
```

- Runs the filter classes from `signal-processing.ts` on the raw sample arrays
- Uses `filtfilt` (zero-phase) for LPF, forward-backward EMA for HPF, cascaded for BPF — consistent with the analysis pipeline
- Memoized on `[samples, filters, sampleRate]`
- Returns flat array of streams, one per (filter, axis) pair

#### Chart Integration

`processIMUChartData` (or a wrapper) merges filtered streams into the chart config:

- Raw series stay as-is (X, Y, Z with their existing colors)
- Each filtered stream becomes an additional uPlot series appended after the raw ones
- Filtered series use dashed stroke (`dash: [6, 4]`) to visually distinguish from raw
- Stats bar shows raw stats only (filtered stats would be confusing)
- Legend toggling works via the existing label-based hidden series mechanism

The series labels must be unique across raw + filtered (e.g., raw "X" vs filtered "X (LPF 5Hz)"). This is natural since the filter description is part of the label.

#### FilterWorkbench Component

A compact, collapsible panel:

```
[v] Filter Workbench                              [Clear All]

Type:  [LPF v]   Cutoff: [5.0] Hz   Axes: [x] X [x] Z [ ] Y   [Apply]

Active filters:
  * LPF 5Hz on X, Z    [x]  ← click to remove
  * BPF 0.3-10Hz on X  [x]
```

- Collapsible to stay out of the way when not in use
- "Apply" adds a new filter definition (doesn't replace existing)
- Each active filter can be individually removed
- Filter list persists across data type switches (accel vs gyro) but only renders streams for axes matching the current data type
- BPF mode shows two cutoff inputs (low + high)

### Zoom Behavior

When the user zooms, `IMUSensorChart` re-fetches raw samples for the visible range (existing behavior). The `useFilteredStreams` hook re-runs on the new samples, so filtered series update automatically. No separate fetch or cache is needed for filtered data.

### Full-Resolution Data Fetch

Filtering downsampled data doesn't produce meaningful results — LTTB destroys the spectral content that filtering operates on. When filters are active, the workbench fetches full 104 Hz data (`downsample=none`) for the visible time range.

**Gating on duration:** The workbench is only enabled when the visible time range is <= 10 minutes. At 104 Hz, 10 minutes is ~62,400 samples — manageable for client-side filtering and charting. If the user is zoomed out beyond 10 minutes, the workbench shows a message prompting them to zoom in first.

**Flow:**
1. User opens workbench while zoomed into a 3-minute segment
2. Workbench fetches `/api/recordings/{id}/samples?start=...&end=...&downsample=none`
3. Full-res samples cached in component state
4. Filters applied client-side at 104 Hz
5. Chart shows both raw and filtered at full resolution
6. If user zooms to a different range, full-res data is re-fetched for new range

The regular LTTB-downsampled chart continues to use the existing data path. The workbench manages its own separate full-res sample state. When the workbench is collapsed or has no active filters, the chart falls back to the normal downsampled data.

### Color Assignment

Filtered series need distinct colors. Strategy:

- Raw axes use fixed colors (X: red, Y: green, Z: blue — existing)
- Each filter gets an auto-assigned hue rotation from a palette that avoids the raw colors
- If the user configures multiple filters, each gets a distinct hue
- Dashed stroke further distinguishes filtered from raw

## Implementation Plan

### Phase 1: Core filtering + chart integration

1. Create `useFilteredStreams` hook in `src/components/charts/hooks/`
2. Extend `processIMUChartData` (or create a wrapper) to accept additional streams and merge into chart config
3. Create `FilterWorkbench` component with the config UI
4. Wire into `RecordingChartClient`

### Phase 2: Polish

1. Persist filter definitions in URL search params (so page refresh preserves config)
2. Preset filters matching pipeline stages ("Show braking LPF", "Show stability BPF")
3. Effective sample rate display

## Decisions

1. **Zero-phase vs causal:** Both. Offer a toggle per filter definition (`phase: 'zero' | 'causal'`). Zero-phase uses `filtfilt`/`filtfiltEma` (matches braking pre-pass). Causal uses forward-only `LowPassFilter`/`HighPassFilter`/`BandPassFilter` (matches stability/roughness first pass). Defaults to zero-phase.

2. **Full-resolution only:** Filtering downsampled data (LTTB at 2-5k samples) doesn't produce meaningful results — the spectral content is already destroyed. The workbench is gated on visible time range <= 10 minutes. When the user opens the workbench (or applies a filter), fetch the full 104 Hz data for the visible range via `downsample=none`. This can be up to ~62k samples per minute of visible data, which is manageable client-side.

3. **Recording page only.** This is a tuning/debugging tool, not user-facing analytics. The ride page shows computed metrics; this page shows the raw signal and how filters transform it.

4. **Cross-axis overlay deferred.** Single data type (accel or gyro) per chart, same as current. Cross-axis comparison (e.g., accel_x + gyro_y) is a future enhancement.
