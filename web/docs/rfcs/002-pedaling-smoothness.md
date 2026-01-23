  Overview

  Add a new "Pedaling Efficiency" tab to ride detail page that measures pedaling
  smoothness by analyzing longitudinal acceleration from VTX IMU data, compensated
  for gravity using GPS grade data.

  Architecture

  1. Time Series Sync Library (New - Shared Utility)

  Location: lib/sync/fit-vtx-sync.ts

  Purpose: Abstract the timestamp-based syncing logic currently duplicated in:
  - Map overlay IMU time ranges (ride-visualizations-client.tsx:42-50)
  - Future pedaling efficiency analysis

  API:
  interface SyncedDataPoint<F, V> {
    timestamp: number  // Unix ms
    fit: F | null      // FIT sample (if exists at this time)
    vtx: V | null      // VTX sample (if exists at this time)
  }

  // Merge FIT + VTX samples into unified timeline
  function syncFitVtxData<F, V>(
    fitSamples: Array<F & { timestamp: string }>,
    vtxSamples: Array<V & { timestamp: string }>,
    options?: {
      interpolate?: boolean  // Future: interpolate missing values
      tolerance?: number     // Max time diff in ms to consider "synced"
    }
  ): SyncedDataPoint<F, V>[]

  // Find VTX samples within time range (for map overlay)
  function getVtxTimeRanges(
    vtxRecordings: Array<{ start_time: string; end_time: string }>
  ): Array<{ start: number; end: number }>

  // Find closest sample by timestamp (for hover sync)
  function findClosestByTime<T>(
    samples: Array<T & { timestamp: string }>,
    targetTime: number  // Unix seconds
  ): { sample: T; index: number } | null

  2. Signal Processing Pipeline

  Location: lib/analysis/pedaling-efficiency.ts

  Processing Steps:
  interface PedalingEfficiencyInput {
    vtxSamples: Array<{ timestamp: string; accel_x: number }>
    fitSamples: Array<{ timestamp: string; grade?: number; altitude?: number }>
    sampleRate?: number  // Default 25 Hz
  }

  interface PedalingEfficiencyOutput {
    timestamp: string
    efficiency: number      // 0-1, higher = smoother
    rawAccel: number       // m/s^2
    compensatedAccel: number  // m/s^2
    grade: number | null   // Percent slope
  }

  // Main pipeline
  function calculatePedalingEfficiency(
    input: PedalingEfficiencyInput
  ): PedalingEfficiencyOutput[]

  Step-by-step:
  1. Sync VTX accel_x with FIT grade by timestamp
     └─ Use lib/sync/fit-vtx-sync.ts

  2. Get/calculate grade:
     Option A: Use FIT record.grade field (if exists - CHECK THIS!)
     Option B: Calculate from altitude: atan(dAlt/dDist) * 100
     └─ Smooth grade with 10-second moving average

  3. Pre-filter accel_x to remove sensor noise:
     └─ Apply low-pass filter (5-10 Hz cutoff)
     └─ Use existing LowPassFilter from signal-processing.ts
     └─ This removes high-freq noise before gravity compensation

  4. Compensate gravity:
     accel_compensated = accel_filtered - sin(atan(grade/100)) * 9.81

  5. Calculate efficiency metric:
     └─ Rolling window std deviation (2-5 second window)
     └─ Normalize: efficiency = 1 / (1 + std_dev)
     └─ Returns 0-1 score (1 = perfectly smooth)

  3. API Endpoint

  Location: app/api/rides/[id]/pedaling-efficiency/route.ts

  Request: GET /api/rides/{id}/pedaling-efficiency

  Query params:
  - window_size? - Smoothness calculation window in seconds (default: 3)
  - lpf_cutoff? - Low-pass filter cutoff Hz (default: 8)

  Response:
  {
    "samples": [
      {
        "timestamp": "2024-01-15T10:30:45.123Z",
        "efficiency": 0.85,
        "rawAccel": 1.2,
        "compensatedAccel": 0.3,
        "grade": 5.2
      }
    ],
    "metadata": {
      "avgEfficiency": 0.82,
      "smoothPercent": 75.3,
      "totalSamples": 12450,
      "hasCadence": false,
      "hasGrade": true
    }
  }

  Logic:
  1. Fetch ride + VTX recordings (filtered by status='ready')
  2. Fetch FIT samples (fields: timestamp, grade, altitude)
  3. Fetch VTX samples (fields: timestamp, accel_x)
  4. Run calculatePedalingEfficiency() pipeline
  5. Calculate summary stats
  6. Return time series + metadata

  4. UI Components

  New Tab: components/pedaling-efficiency-tab.tsx
  interface PedalingEfficiencyTabProps {
    rideId: string
    highlightTime: number | null  // For time slider sync
  }

  Features:
  - Lazy load data on tab open (not on page load)
  - Line chart: efficiency over time (0-1 scale or 0-100%)
  - Color zones: green (smooth) > 0.7, yellow 0.5-0.7, red < 0.5
  - Sync with time slider
  - Summary card: avg efficiency, % time smooth/rough
  - Handle missing grade gracefully (show warning)

  Chart library: Reuse existing uPlot setup from IMU charts

  Integration point: Add to data-tabs.tsx alongside "Performance", "IMU", etc.

  5. Filtering Strategy

  The Noise Problem:
  At 25 Hz with sensor noise, raw accel_x has 0.5-1 m/s^2 noise floor. This swamps 
  the actual pedaling signal (0.1-0.3 m/s^2 variations).

  Solution: Two-stage filtering

  Stage 1: Low-pass pre-filter (before gravity compensation)
  - Cutoff: 8 Hz (removes sensor noise, keeps pedal frequency)
  - Pedaling is 40-180 RPM = 0.67-3 Hz
  - Use LowPassFilter from existing signal-processing.ts
  - Critical: Filter BEFORE gravity compensation to avoid amplifying noise

  Stage 2: Smoothness calculation (after compensation)
  - Rolling window std dev (2-5 second window = 50-125 samples @ 25Hz)
  - Captures pedal stroke variability without smoothing it away

  Visual comparison:
  Raw accel:           ████████████████████  (noisy mess)
  After 8Hz LPF:       ▁▂▃▂▁▂▃▂▁▂▃▂▁       (clean pedal strokes visible)
  After compensation:  ▁▂▁▂▁▂▁▂▁▂▁▂▁       (gravity removed)
  Efficiency metric:   ━━━━━━━━━━━━━━━━━   (smoothness over time)

  Open Questions

  Q1: Does FIT have record.grade field?

  Status: YES - confirmed in API route (line 237: grade: record.grade || null)

  Decision:
  - Primary: Use FIT record.grade if exists
  - Fallback: Calculate from altitude if record.grade is null
  - Apply 10-sec moving average to smooth either source

  Q2: Grade smoothing window size?

  Options:
  - 5 seconds: Responsive but noisy on variable grades
  - 10 seconds: Good balance (recommended)
  - 15 seconds: Very smooth but lags on grade changes

  Recommendation: 10 seconds (250 samples @ 25Hz)

  Q3: Efficiency metric display format?

  Options:
  - 0-1 decimal: 0.85
  - 0-100 percent: 85%
  - Inverted "roughness" score
  - Letter grade: A/B/C/D/F

  Recommendation: 0-100% with color zones

  Q4: Missing grade handling?

  If FIT has no grade field and altitude is flat/missing:

  Options:
  - Skip gravity compensation (show warning)
  - Assume flat (grade=0)
  - Don't show efficiency tab

  Recommendation: Skip compensation, show "Limited accuracy - no grade data" banner

  Implementation Order

  1. ✅ Sync library - Abstract time syncing logic
  2. ✅ Signal processing pipeline - Core algorithm with tests
  3. ✅ API endpoint - Fetch + process + return
  4. ✅ Basic chart component - Line chart with efficiency over time
  5. ✅ Tab integration - Add to data-tabs.tsx with lazy load
  6. 🔄 Summary stats card - Avg efficiency, smooth %
  7. 🔄 Validation with power meter - Test on road bike with cadence

  Success Metrics

  - Efficiency correlates with subjective feel of smooth/rough sections
  - Low scores on known "mashing" climbs
  - High scores on seated tempo efforts
  - Matches power meter variability on road bike (future validation)