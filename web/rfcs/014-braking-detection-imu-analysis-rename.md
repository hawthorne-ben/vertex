# RFC 014: Braking Detection & IMU Analysis Pipeline Rename

**Status:** Implemented (v7.0.0)
**Date:** 2026-03-12

## Summary

Added braking event detection from IMU accelerometer data using pitch analysis, and renamed the analysis pipeline from "pedaling efficiency" to "ride IMU analysis" to reflect its expanded scope.

## Motivation

1. **Braking detection**: Riders want to understand braking behavior, especially on descents. Braking intensity correlates with skill, confidence, and safety. No additional hardware needed — the frame-mounted IMU already captures the signal.

2. **Pipeline naming**: The inngest job and core library were named `calculate-pedaling-efficiency` but now compute stability, roughness, riding position, and braking — all IMU-derived metrics with shared preprocessing. The name was misleading and discouraged adding new metrics.

## Braking Detection Algorithm

### Core Insight

Braking and road grade both shift the gravity vector along the accelerometer's X-axis (longitudinal). But grade changes slowly (10-30s timescale) while braking changes fast (<5s). They're separated by frequency, not by axis.

### Signal Processing Pipeline

All steps run in the existing per-sample preprocessing loop (no additional data passes):

```
1. LPF accel_x, accel_z (2 Hz cutoff)     → removes vibration, pedaling forces
2. pitch = atan2(smooth_x, smooth_z)        → instantaneous frame tilt (radians)
3. grade_baseline = EMA(pitch, 10s window)  → slow-moving road grade estimate
4. braking_pitch = pitch - grade_baseline   → fast transient = braking
5. braking_decel = g * sin(braking_pitch)   → convert to m/s², positive = deceleration
6. clamp to max(0, braking_decel)           → only deceleration, not acceleration
```

### Windowed Aggregation (3s window, 0.5s hop)

Uses **peak** braking deceleration per window (not mean) to capture short hard brakes without dilution. A 1-second brake tap in a 3-second window reports the peak value, not 1/3 of it.

### Thresholds & Scaling

| Parameter | Default | Description |
|-----------|---------|-------------|
| `BRAKING_LPF_HZ` | 2.0 | Noise removal cutoff before pitch calc |
| `BRAKING_GRADE_WINDOW_SECONDS` | 10 | Grade baseline rolling average window |
| `BRAKING_THRESHOLD_MS2` | 0.8 m/s² | Min deceleration to register as braking |
| `BRAKING_MAX_MS2` | 6.0 m/s² | Ceiling for 0-100 intensity scaling |

Braking intensity = `min(100, peak_decel / max_decel * 100)`

### Reference Deceleration Values (from SAE 2020-01-0876)

| Condition | Deceleration |
|-----------|-------------|
| Rear brake only | 2.5 – 3.6 m/s² |
| Combined front + rear | 3.9 – 7.0 m/s² |
| Comfortable braking | 0.7 – 2.6 m/s² |
| Near pitch-over limit | ~6.9 m/s² (~0.7g) |

### Distinguishing Braking from Other Deceleration

| Source | Magnitude | How it's handled |
|--------|-----------|------------------|
| Road grade | 0.98 m/s² per 10% | Absorbed by grade baseline (10s EMA) |
| Aero drag | 0.1–0.5 m/s² | Below threshold (0.8 m/s²) |
| Rolling resistance | ~0.3 m/s² | Below threshold |
| Braking | 1.5–7.0 m/s² | Fast onset, above threshold |
| Bumps | Variable | Short duration, high-frequency — smoothed by LPF |

### Free Byproduct: IMU-Derived Grade

The grade baseline (`tan(grade_pitch) * 100`) gives a 25+ Hz grade estimate derived purely from IMU data, potentially higher resolution than the 1 Hz FIT grade data. Stored in `estimatedGradePercent` per sample.

## Output Types

```typescript
interface BrakingSample {
  timestamp: string
  isBraking: boolean
  brakingIntensity: number        // 0-100
  brakingDecelerationMs2: number  // peak raw deceleration in window
  estimatedGradePercent: number   // IMU-derived grade
}

interface BrakingMetadata {
  totalBrakingEvents: number       // distinct episodes
  totalBrakingSeconds: number
  avgBrakingIntensity: number      // 0-100 during braking
  maxBrakingIntensity: number
  maxBrakingDecelerationMs2: number
  brakingPercent: number           // % of ride time
  totalSamples: number
  sampleRate: number | null
}
```

## File Renames

| Old Path | New Path |
|----------|----------|
| `src/lib/analysis/pedaling-efficiency-constants.ts` | `src/lib/analysis/imu-constants.ts` |
| `src/lib/analysis/pedaling-efficiency.ts` | `src/lib/analysis/ride-imu-analysis.ts` |
| `src/inngest/functions/calculate-pedaling-efficiency.ts` | `src/inngest/functions/analyze-ride-imu.ts` |

### Variable Renames

| Old | New |
|-----|-----|
| `STFT_WINDOW_SECONDS` | `WINDOW_SECONDS` |
| `STFT_HOP_SECONDS` | `WINDOW_HOP_SECONDS` |
| `STFT_FFT_SIZE` | `FFT_SIZE` |
| `stftResults` / `StftResult` | `windowResults` / `WindowResult` |
| `calculatePedalingEfficiencyJob` | `analyzeRideImuJob` |
| Inngest function ID: `calculate-pedaling-efficiency` | `analyze-ride-imu` |

The main function is still named `calculatePedalingEfficiency` for now — renaming it would touch many more files and the API route paths.

## Architecture: Single-Pass Multi-Metric Pipeline

All metrics share the same two-pass structure:

### Pass 1: Per-sample filtering (native Hz, 104 Hz for v2 firmware)

Each sample gets multiple filtered views applied in a single loop:

| Metric | Filter | Input Axes |
|--------|--------|-----------|
| Stability | BPF 0.3–10 Hz | gyro_x, gyro_z, accel_x |
| Roughness | HPF 0.5 Hz | accel_x, accel_z |
| Position | HPF 0.5 Hz + BPF 0.3–4 Hz | accel_y, gyro_x |
| **Braking** | **LPF 2 Hz + EMA grade baseline** | **accel_x, accel_z** |

### Pass 2: Windowed aggregation (3s window, 0.5s hop → ~2 Hz)

| Metric | Aggregation | Condition |
|--------|-------------|-----------|
| Stability | Weighted RMS | When pedaling |
| Roughness | Combined magnitude RMS | When moving |
| **Braking** | **Peak deceleration** | **Always** |

### Pass 3: Output interpolation to 5 Hz + position detection

Position detection runs at 5 Hz with its own windowing. All windowed results are linearly interpolated from ~2 Hz to 5 Hz output rate.

## Database

- New `analysis_type: 'braking'` row in `ride_analysis` table
- New fields in `ride_summaries`: `total_braking_events`, `braking_percent`, `avg_braking_intensity`, `max_braking_intensity`, `braking_version`

## Roughness Speed Scaling (also in this version)

Changed from linear interpolation (4 params) to power-law scaling (3 params):

```
ceiling = baseCeiling * (speed / referenceSpeed) ^ exponent
```

- `ROUGHNESS_BASE_CEILING = 50.0` (RMS ceiling at reference speed)
- `ROUGHNESS_REFERENCE_SPEED_MS = 6.0` (~13 mph)
- `ROUGHNESS_SPEED_EXPONENT = 1.0` (tunable: 0.5=sqrt, 1.0=linear, 2.0=energy)

## Tuning

All braking parameters are exposed in the dev tuning modal alongside stability, roughness, and position parameters. The modal now shows braking results (events, % time, avg/max intensity).
