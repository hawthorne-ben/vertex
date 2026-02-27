# RFC 013: Pedaling Stability & Surface Roughness

**Status:** Accepted (Implemented)
**Created:** 2026-02-23
**Updated:** 2026-02-24
**Author:** Claude
**Supersedes:** RFC 002 (Pedaling Smoothness)
**Algorithm Version:** 6.0.0

## Summary

Replace the current accel-magnitude stdDev efficiency algorithm with a dual-metric system: **Pedal Stability** (time-domain RMS of bandpass-filtered gyro signals) and **Surface Roughness** (multi-axis accel RMS). The current algorithm is fundamentally a vibration dose proxy that inversely correlates with speed, not pedaling technique.

## Problem

The current algorithm (v4.0.0) computes efficiency as:

```
rawAccel = sqrt(accel_x² + accel_y² + accel_z²)
filteredAccel = HPF(rawAccel, 0.5 Hz)
stdDev = stdDev(filteredAccel, 3-second window)
efficiency = exp(-0.18 * stdDev)
```

This fails because:

1. **Road noise dominates accel at speed.** High-speed road impacts produce broadband energy in the 0.5-10 Hz range — the same range as pedaling. The 0.5 Hz HPF removes gravity but not road noise, so efficiency drops during fast descents regardless of pedaling quality.

2. **The metric is an inverse function of speed.** Road-induced vibration energy scales with v² to v³ depending on surface. Faster = more vibration = higher stdDev = lower "efficiency." Empirically confirmed: descending produces the lowest scores, smooth flat tempo the highest.

3. **Accel-x has weak pedaling signal.** The longitudinal acceleration from pedaling (0.1-0.3 m/s² variations) is swamped by road noise at the same frequencies. No amount of filtering separates them because they occupy the same spectral band.

4. **Gyro-x is already proven better.** The riding position algorithm uses gyro-x (roll rate) with 70% weight because it cleanly captures periodic body motion while rejecting road noise. Road hits create vertical/longitudinal impulses (accel) but minimal frame roll (gyro).

## Design

### Two Distinct Metrics

Instead of one "efficiency" percentage that becomes meaningless during descents, split into two metrics that separate rider technique from road conditions.

#### Metric 1: Pedal Stability (replaces "efficiency")

Measures how much oscillation the rider produces in the pedaling frequency band. A stable, smooth pedal stroke produces minimal frame roll and yaw; rocking, mashing, and poor core engagement produce large oscillations.

**Signals (weighted fusion):**
- **Gyro-x (roll rate)** — primary (70%). Frame roll from pedaling is periodic and clean; road noise produces minimal roll. Already proven in position detection.
- **Gyro-z (yaw rate)** — secondary (30%). Handlebar instability shows up as yaw oscillation — an unstable rider pulls the bars side to side under load. Empirically confirmed: gyro-x and gyro-z are highly correlated during pedaling.
- **Accel-x (longitudinal surge)** — disabled (0%). Accel is in different units (m/s²) than gyro (rad/s), making weighted fusion meaningless without unit normalization. The gyro signals capture pedaling instability more cleanly.

**Method:** BPF (0.3-10 Hz) each gyro axis → time-domain RMS in sliding windows → weighted fusion → ceiling normalization.

**Active only when:** FIT cadence > 0 (existing gate)

#### Metric 2: Surface Roughness (new)

Measures road-induced vibration that costs the rider energy through tire/frame/body dissipation. This is what the current "efficiency" metric actually measures — reframe it as the useful metric it is.

**Signals:** Accel-x (longitudinal) and accel-z (vertical), combined as magnitude. On climbs, road impacts shift from purely vertical into the longitudinal axis as the bike pitches up; on descents, the reverse. Using only accel-z would undercount roughness on steep grades. Accel-y (lateral) is excluded because lateral acceleration is dominated by cornering and pedaling rock, not road surface.

**Method:** RMS of combined accel-x/z magnitude in rolling windows

**Always active:** Reported regardless of pedaling state

### Pedal Stability Algorithm

#### Step 1: Extract cadence from FIT

```
cadence > 0 → pedaling (compute stability)
cadence = 0 or null → not pedaling (stability = null)
```

Cadence is carried forward between 1 Hz FIT samples (existing behavior).

#### Step 2: Bandpass filter input signals

Apply BPF (0.3-10 Hz) to each stability signal independently:
- `BPF(gyro_x)` — roll rate in human-frequency range
- `BPF(gyro_z)` — yaw rate in human-frequency range

At 25 Hz sample rate, Nyquist is 12.5 Hz so there's minimal content above 10 Hz anyway. The BPF removes DC drift on the low end (including sustained cornering lean, which is sub-0.3 Hz) and any aliased noise on the high end.

**Why the BPF rejects cornering:** A sustained lean through a corner is essentially a DC shift in roll rate — the bike holds a constant lean angle. The BPF's 0.3 Hz low cutoff attenuates this. Corner entry/exit are transients, but with a 3-second window the BPF has time to settle. This was empirically validated: the FFT-based approach (v5.0-5.2) could not reject cornering transients because broadband spectral leakage from the lean step-function leaked into cadence bins despite windowing and floor subtraction.

#### Step 3: Windowed RMS (per axis)

For each 3-second window (75 samples at 25 Hz), for each stability axis:

```
axisRms = sqrt(mean(bpfSignal²))
```

This is identical to the approach used in riding position detection (which works reliably). The BPF has already isolated the pedaling band — no further frequency-domain analysis is needed.

#### Step 4: Weighted fusion and ceiling normalization

```
weightedRms = 0.7 * rollRms + 0.3 * yawRms
stability = max(0, 1 - weightedRms / MAX_STABILITY_RMS)
```

Where `MAX_STABILITY_RMS = 5.0` rad/s is a tunable ceiling. At this value, stability is 0%. At 0, stability is 100%.

**Why this scale works:** During smooth pedaling, gyro-x RMS is ~1-3 rad/s. During sloppy pedaling with body rocking, it's ~5-8 rad/s. The ceiling of 5.0 puts the crossover between "good" and "bad" technique in a reasonable range.

Optional power normalization (off by default): divide weightedRms by instantaneous watts before ceiling normalization, allowing higher-power efforts more motion tolerance.

#### Step 5: Handle edge cases

- **Cadence = 0 or null:** Return `null` (not pedaling, same as current behavior)
- **No gyro-z data:** Redistribute yaw weight to roll (roll = 1.0)
- **No gyro data at all:** Fall back to accel-x only (degraded mode)
- **First/last partial windows:** Use available samples, skip if < 50% of window size

### Surface Roughness Algorithm

#### Step 1: HPF accel-x and accel-z at 0.5 Hz

Remove gravity components from both axes (existing `HighPassFilter`).

#### Step 2: Compute combined magnitude

```
roughnessSignal = sqrt(filteredAccelX² + filteredAccelZ²)
```

This captures road vibration regardless of bike pitch angle. On a 10% grade, gravity projects ~1 m/s² into accel-x — the HPF removes this static component, leaving only dynamic road impacts.

#### Step 3: RMS in rolling windows

```
roughnessRms = sqrt(mean(roughnessSignal² over 3-second window))
```

#### Step 4: Normalize to score

```
roughness = min(1.0, roughnessRms / MAX_ROUGHNESS_RMS)
```

Where `MAX_ROUGHNESS_RMS` is a tunable constant calibrated from real rides (5.0 m/s²). Higher = rougher surface.

### Constants

Constants in `pedaling-efficiency-constants.ts`:

```typescript
// Windowed RMS Configuration
export const STFT_WINDOW_SECONDS = 3       // Sliding window for RMS
export const STFT_HOP_SECONDS = 0.5        // 2 Hz output rate

// Stability Bandpass Filter
export const STABILITY_BPF_LOW_HZ = 0.3    // Rejects sustained cornering lean
export const STABILITY_BPF_HIGH_HZ = 10.0  // Below Nyquist, captures harmonics

// Stability Axis Weights (gyro-only, must sum to 1.0)
export const STABILITY_ROLL_WEIGHT = 0.7   // Gyro-x: frame roll (primary)
export const STABILITY_YAW_WEIGHT = 0.3    // Gyro-z: handlebar stability
export const STABILITY_SURGE_WEIGHT = 0.0  // Accel-x: disabled (unit mismatch)

// Stability Ceiling Normalization
export const MAX_STABILITY_RMS = 5.0       // RMS at this value = 0% stability
export const MAX_STABILITY_RMS_PER_WATT = 0.02  // Per-watt ceiling (optional)
export const POWER_NORMALIZE_STABILITY = false   // Off by default

// Surface Roughness
export const ROUGHNESS_HPF_CUTOFF_HZ = 0.5
export const MAX_ROUGHNESS_RMS = 5.0       // Calibrate from real data
export const ROUGHNESS_WINDOW_SECONDS = 3
```

### Data Model

#### PedalingEfficiencyOutput (stability samples)

```typescript
interface PedalingEfficiencyOutput {
  timestamp: string
  stability: number | null         // 0-1, higher = more stable
  stabilityPercent: number | null  // 0-100
  isPedaling: boolean
  cadence: number | null
  cadenceHz: number | null         // f₀ = cadence/60 (for debug)
  rollRms: number | null           // Gyro-x BPF'd RMS (rad/s, debug)
  yawRms: number | null            // Gyro-z BPF'd RMS (rad/s, debug)
  surgeRms: number | null          // Accel-x BPF'd RMS (m/s², debug)
  weightedRms: number | null       // Weighted RMS before ceiling (debug)
  cadenceEnergy: number | null     // Reserved for future spectral use
  grade: number | null
}
```

#### SurfaceRoughnessSample

```typescript
interface SurfaceRoughnessSample {
  timestamp: string
  roughness: number       // 0-1 normalized score
  roughnessRms: number    // Raw RMS value in m/s²
  speed: number | null    // From FIT, for correlation analysis
}
```

#### SurfaceRoughnessMetadata

```typescript
interface SurfaceRoughnessMetadata {
  avgRoughness: number
  maxRoughness: number
  smoothSurfacePercent: number    // % time below roughness 0.3
  roughSurfacePercent: number     // % time above roughness 0.7
  totalSamples: number
  sampleRate: number
}
```

### Algorithm Version

Version `6.0.0` — time-domain RMS stability + surface roughness.

This triggers recomputation for all existing rides. The version check in the Inngest job compares stored `algorithm_version` against the constant. When bumped, rides are detected as stale and recomputed on next trigger.

### Database Changes

Add `'surface_roughness'` to the `analysis_type` CHECK constraint on `ride_analysis`:

```sql
ALTER TABLE ride_analysis
  DROP CONSTRAINT ride_analysis_analysis_type_check,
  ADD CONSTRAINT ride_analysis_analysis_type_check
    CHECK (analysis_type IN ('pedaling_efficiency', 'riding_position', 'surface_roughness'));
```

Update `ride_summaries` denormalization to include roughness columns:

```sql
ALTER TABLE ride_summaries
  ADD COLUMN avg_roughness REAL,
  ADD COLUMN max_roughness REAL,
  ADD COLUMN smooth_surface_percent REAL,
  ADD COLUMN rough_surface_percent REAL;
```

### Processing Pipeline

The main `calculatePedalingEfficiency()` function:

**First pass (per-sample filtering):**
1. Sync FIT + VTX by timestamp
2. Carry forward FIT cadence and speed
3. BPF gyro-x (0.3-10 Hz) — roll rate for stability
4. BPF gyro-z (0.3-10 Hz) — yaw rate for stability
5. HPF accel-x (0.5 Hz) — for roughness
6. HPF accel-z (0.5 Hz) — for roughness
7. HPF accel-y (0.5 Hz) — for position detection (unchanged)

**Second pass (windowed RMS):**
1. For each window position (advancing by 0.5s):
   - **Stability:** RMS of BPF'd gyro-x and gyro-z → weighted fusion → ceiling normalization
   - **Roughness:** RMS of `sqrt(hpfAccelX² + hpfAccelZ²)` → ceiling normalization
2. Output at ~2 Hz (one per 0.5s hop)

**Third pass (interpolation + position):**
- Linearly interpolate windowed output from 2 Hz to 25 Hz sample timestamps for output arrays and map overlay
- Riding position detection (unchanged from v4)

### UI Changes

#### Tab Layout

```
[ Stability ] [ Position ] [ Stats ] [ Orientation ] [ Acceleration ] [ Rotation ]
```

Query params use `?tab=stability&chart=stability`. Legacy `?tab=efficiency` URLs are migrated to `stability` on load for backwards compatibility.

#### Map Overlay

Each analytics tab controls its own map overlay:
- **Stability:** Green (stable) → Red (unstable technique)
- **Position:** Green (seated) → Orange (standing). Unchanged.

### What Stays the Same

- **FIT cadence gating** — pedaling detection via cadence > 0
- **Riding position detection** — Y-axis + gyro-x fusion (untouched)
- **Inngest job orchestration** — same `ride/vtx.merged` event trigger
- **API endpoints** — same shape, field names changed (efficiency → stability)
- **Dev tuning modal** — same pattern, updated parameters
- **FIT-VTX sync** — unchanged

### What Changes

| Component | Before (v4) | After (v6) |
|-----------|-------------|------------|
| Stability signal | accel magnitude (3-axis) | gyro-x + gyro-z (weighted) |
| Stability method | HPF → stdDev → exp decay | BPF → time-domain RMS → ceiling normalization |
| Frequency analysis | None | None (FFT removed in v6, retained for future use) |
| Metric name | "efficiency" | "stability" |
| Road noise handling | Ignored (causes bad scores) | Separated into surface roughness |
| Cornering rejection | None (corners = low "efficiency") | BPF attenuates sub-0.3 Hz sustained lean |
| Roughness signal | N/A | accel-x + accel-z magnitude |
| During descents | Reports ~30% "efficiency" | null stability + high roughness score |
| URL params | `?tab=efficiency` | `?tab=stability` (with legacy migration) |
| DB | 2 analysis types | 3 analysis types |

## Algorithm Evolution Log

| Version | Approach | Problem |
|---------|----------|---------|
| v4.0.0 | Accel magnitude → HPF → stdDev → exp decay | Measures road vibration, not pedaling technique |
| v5.0.0 | Multi-axis STFT → spectral coherence ratio (cadence/human band) | Road noise raises both numerator and denominator equally — ratio is insensitive |
| v5.1.0 | Multi-axis STFT → cadence-band RMS with ceiling normalization | FFT magnitude not normalized by N — RMS values in arbitrary units, not physical |
| v5.1.1 | Fixed FFT normalization (÷ fftSize) | Cornering transients leak broadband energy into cadence bins via spectral leakage |
| v5.2.0 | Added median spectral floor subtraction (SNR) | Still picks up corners — floor subtraction insufficient for step transients |
| **v6.0.0** | **BPF → time-domain RMS (no FFT)** | **Current. BPF rejects sustained lean. Matches position detection approach.** |

**Key insight from v5→v6:** The BPF already does the frequency isolation that the FFT was trying to do. The FFT added complexity (windowing, zero-padding, normalization, spectral leakage) without benefit. Cornering is a sub-0.3 Hz phenomenon that the BPF attenuates — no spectral analysis needed. The position detection algorithm proved this approach works: BPF'd gyro → windowed RMS → threshold.

## Design Decisions

- **Time-domain RMS over FFT spectral analysis:** Versions 5.0-5.2 attempted FFT-based cadence-band energy measurement. This failed because cornering transients (lean-in/out) are step functions whose FFT spreads energy across all bins, including cadence bins. Floor subtraction (v5.2) was insufficient because the transient energy is not uniform — it's shaped by the Hanning window. The BPF already isolates the pedaling band (0.3-10 Hz) and attenuates cornering lean (sub-0.3 Hz). Time-domain RMS of the BPF'd signal is simpler, more robust, and matches the proven position detection approach.
- **Gyro-only stability (surge weight = 0):** Accel-x is in m/s² while gyro is in rad/s. Weighting them together in a linear sum is physically meaningless without unit normalization. Gyro signals capture pedaling instability more cleanly — road noise produces minimal frame roll/yaw. Accel-x was disabled rather than removed, so it can be re-enabled with proper normalization in the future.
- **70/30 roll/yaw weights:** Gyro-x (roll) is the cleanest pedaling signal — body rocking directly produces frame roll. Gyro-z (yaw) captures handlebar instability which is mechanically coupled to roll through bar input. 70/30 reflects roll's higher SNR while still rewarding handlebar stability.
- **Accel-x/z for roughness, not all 3 axes:** Road impacts are primarily vertical (accel-z) and longitudinal (accel-x, especially on grades). Accel-y (lateral) is dominated by cornering forces and pedaling rock, which would contaminate the road surface measurement.
- **FFT code retained:** `src/lib/imu/fft.ts` is kept for future spectral features (see Appendix A). The stability algorithm no longer uses it, but the infrastructure is available.
- **MAX_STABILITY_RMS = 5.0 rad/s:** With BPF'd gyro-x oscillating at 10-15 rad/s peak during strokes, RMS is ~7-10 rad/s for sloppy pedaling and ~1-3 rad/s for smooth pedaling. 5.0 puts the midpoint in a useful range. Tunable via dev modal.
- **No "lost watts" estimation:** Accurate watt estimation from vibration requires tire pressure, rider weight, and bike mass data we don't have. Report roughness as a normalized score.
- **Legacy URL migration:** `?tab=efficiency` → `?tab=stability` handled in `ride-visualizations-client.tsx` via `migrateTabParam()` so bookmarks and browser history continue to work.

## FIT Power Meter Data: Complementary Metrics

The FIT file format contains pedaling dynamics fields from power meters that we are not currently extracting. These metrics measure force *at the crank* — complementary to our IMU metrics which measure *what the bike frame does* in response. Neither replaces the other.

### Available FIT Pedaling Fields

**Per-second record-level data** (requires power meter):

| Field | What It Measures | Units | Requires |
|-------|-----------------|-------|----------|
| `left/right_torque_effectiveness` | % of pedal stroke with positive torque | 0-100% | Any power meter |
| `left/right_pedal_smoothness` | Evenness of power across the stroke (avg/peak) | 0-100% | Any power meter |
| `combined_pedal_smoothness` | Both legs combined | 0-100% | Any power meter |
| `left/right_power_phase` | Crank angle range where power is produced | degrees | Dual-sided |
| `left/right_power_phase_peak` | Crank angle range of peak power output | degrees | Dual-sided |
| `left/right_pco` | Pedal center offset | mm | Dual-sided |
| `left_right_balance` | L/R power split | % | Dual-sided |

### IMU vs. Power Meter: What Each Measures

| Aspect | FIT Power Meter | Vertex IMU |
|--------|----------------|------------|
| **What it senses** | Force/torque at the crank spindle | Motion of the bike frame |
| **Torque effectiveness** | Direct measurement | Cannot measure — no force data |
| **Pedal smoothness** | Direct measurement (avg/peak force ratio) | Indirect: RMS of frame oscillation |
| **Core/frame stability** | Cannot measure — no body motion data | Direct: gyro-x/z oscillation |
| **L/R balance** | Direct measurement (dual-sided only) | Cannot isolate per-leg |
| **Road surface** | Cannot measure | Direct: accel-x/z RMS |

**Key insight:** A rider can have perfect torque effectiveness (smooth force at the crank) but terrible core stability (rocking the bike). Or vice versa. The metrics are complementary, not redundant. Vertex's unique value is providing technique feedback to riders *without* power meters, and providing body/frame dynamics data that power meters cannot capture.

### Future: Calibration and Cross-Reference

For riders with power meters, correlate IMU stability against FIT `combined_pedal_smoothness`. If they correlate, the IMU metric is capturing real technique. If they diverge, that's a coaching insight:

- "Your body was stable (Stability: 85%) but your backstroke is dragging (Torque Effectiveness: 62%)"
- "Smooth force application (FIT Smoothness: 90%) but excessive frame rock (IMU Stability: 45%) — tighten your core"

## Appendix A: Future FFT Use Cases

The FFT infrastructure (`src/lib/imu/fft.ts`: Hanning window, radix-2 Cooley-Tukey, power spectrum, band energy) is retained for future spectral features. Below are concrete use cases organized by what's possible at the current 25 Hz sample rate vs. what would require upgrading to 100+ Hz.

### At 25 Hz (current hardware)

#### Cadence Estimation from IMU Alone

Detect the dominant frequency in gyro-x via FFT peak-picking when no cadence sensor or FIT data is available. 25 Hz gives 12.5 Hz Nyquist, covering cadences up to 750 RPM. This enables stability scoring for rides recorded without a bike computer — VTX-only rides where cadence is currently null and stability is not computed.

#### Pedal Stroke Asymmetry (L/R Balance Proxy)

Compare energy at f₀ (cadence) vs. 2f₀ (twice cadence). A symmetric stroke has most energy at 2f₀ — two legs produce two pushes per revolution. An asymmetric stroke shifts energy toward f₀ — one dominant leg produces one strong push per revolution. The ratio f₀/2f₀ is a left-right imbalance proxy without requiring a dual-sided power meter. This could be displayed as a "balance score" alongside stability.

#### Road Surface Classification

FFT of HPF'd accel-z to identify surface types by spectral shape rather than just RMS magnitude. Smooth tarmac has low broadband energy, chip-seal has a characteristic peak at the tire contact frequency, cobblestones have a periodic impulse signature. The existing roughness metric (RMS) measures *how much* vibration; spectral classification would identify *what type* of surface, enabling automatic segment tagging (tarmac / chip-seal / gravel / cobbles).

#### Vibration Fatigue Estimation (ISO 2631)

The ISO 2631 standard defines frequency-weighted acceleration dose for human vibration exposure. The weighting curve peaks at 4-8 Hz for vertical and 1-2 Hz for lateral vibration, matching human body resonance. The FFT enables applying this frequency weighting to compute cumulative vibration dose over a ride — a metric relevant for long gravel/endurance rides where fatigue from road vibration is a real performance factor. Could be displayed as "vibration dose" in the ride summary.

### At 100+ Hz (future hardware upgrade)

#### Wheel/Hub Bearing Diagnostics

Bearing defects produce vibration at specific frequencies determined by rotational speed, number of bearing balls, and geometry (BPFO/BPFI formulas). These signatures typically fall in the 20-50 Hz range — above our current Nyquist. At 100+ Hz, FFT peak detection could identify bearing wear patterns and alert the rider before failure. Requires correlating with wheel speed from the FIT file.

#### Drivetrain Vibration Analysis

Chain slap, derailleur resonance, and chainring tooth wear produce signatures in the 15-50 Hz range. At 25 Hz these are aliased into the data and unresolvable. At 100+ Hz, spectral analysis could detect chain wear (broadening of chainring tooth-pass frequency), derailleur misalignment (resonance under load), and identify optimal chain replacement timing.

#### Tire Pressure Estimation

Tire contact patch resonance frequency shifts with inflation pressure, typically in the 30-60 Hz range. Tracking this resonance peak across a ride could detect slow leaks mid-ride and alert the rider. Requires calibration against known pressures but the physics are well-established (used in automotive TPMS systems).

#### Bump/Pothole Detection and Classification

At 25 Hz, a pothole hit appears as a single-sample spike — unresolvable. At 200+ Hz, the actual impact profile is captured: duration, severity, and shape distinguish potholes from expansion joints from speed bumps from railroad crossings. Combined with GPS, this enables automatic road quality mapping and hazard reporting.

#### Brake Modulation Analysis

Brake grab/release produces high-frequency oscillation (10-40 Hz) in the longitudinal acceleration signal. At 100+ Hz, spectral analysis could score braking smoothness, detect disc brake chatter, and identify over-braking into corners. Combined with speed data, this could provide cornering technique feedback: "You braked 2 seconds too late into turn 4 and had to grab the brakes — try trailing brake entry instead."

#### Frame/Fork Resonance Characterization

Every frame has natural frequencies, typically 20-80 Hz, determined by material stiffness, geometry, and mass distribution. Mapping these per-bike via spectral analysis of road-induced vibration enables: (1) detecting structural changes — a cracked frame shifts its resonance frequency; (2) comparing frame stiffness across bikes; (3) identifying speed-dependent resonance where road vibration at a specific speed excites the frame's natural frequency, causing amplified fatigue.
