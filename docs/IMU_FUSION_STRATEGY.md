# Orientation Fusion Strategy

**Version:** 1.0
**Last Updated:** 2026-01-03
**Status:** Active Development

## Overview

Vertex uses a custom **bicycle-aware complementary filter** to estimate 3D orientation (roll, pitch, yaw) from IMU sensor data. This filter improves upon the BNO055's built-in sensor fusion by exploiting bicycle-specific physics constraints and integrating GPS velocity data.

### Why Custom Fusion?

The BNO055 IMU provides built-in sensor fusion (quaternion-based complementary filter), but has limitations for cycling applications:

1. **No magnetometer** (6-DOF mode) → Yaw drifts unbounded over time
2. **Generic tuning** → Not optimized for bicycle dynamics (bounded roll/pitch, predictable turns)
3. **Closed-source** → Cannot adapt gains for different terrains or riding styles
4. **Known bugs** → Euler angle glitches at >20° (we work around this with quaternions)

**Our goal:** Provide orientation that:
- Has **less yaw drift** than BNO055 (using GPS velocity heading)
- Respects **bicycle physics constraints** (roll/pitch bounds, turn kinematics)
- Is **robust to vibration** (mountain biking, rough roads)
- Enables **post-processing improvements** (tune offline, compare strategies)

---

## Architecture

### Data Flow

```
Raw Sensors (BNO055)
    ↓
[Gyro: deg/s] [Accel: m/s², includes gravity]
    ↓
Unit Conversion (gyro → rad/s)
    ↓
Low-Pass Filtering (denoise BEFORE fusion)
    ├─ Gyro: 10 Hz cutoff (remove vibration, keep motion)
    └─ Accel: 5 Hz cutoff (clean gravity vector, remove bumps)
    ↓
Complementary Fusion
    ├─ Gyro Integration (high-pass, fast response)
    ├─ Accel Gravity Vector (low-pass, long-term correction)
    └─ Adaptive Weighting (trust accel less during dynamics)
    ↓
Bicycle Constraints
    ├─ Soft roll bounds (±45°)
    ├─ Soft pitch bounds (±30°)
    └─ Turn kinematics validation
    ↓
GPS Corrections (optional)
    ├─ Yaw drift correction (heading from velocity)
    └─ Physics-based yaw rate validation
    ↓
Orientation Output (roll, pitch, yaw)
```

### Key Components

| Component | Purpose | Implementation |
|-----------|---------|----------------|
| **Preprocessing Filters** | Remove high-frequency noise (vibration) | Exponential moving average low-pass |
| **Complementary Fusion** | Combine gyro (short-term) + accel (long-term) | Weighted average with adaptive trust |
| **Adaptive Trust** | Reduce accel influence during dynamics | Based on `\|accel\| - g` deviation |
| **Bicycle Constraints** | Soft bounds on physically implausible angles | Gentle pull-back (10% per sample) |
| **GPS Integration** | Correct yaw drift, validate turn rates | Slow heading correction + kinematics check |

---

## Mathematical Foundation

### 1. Complementary Filter Basics

A complementary filter fuses two noisy estimates with complementary frequency characteristics:

```
orientation = α * gyro_integration + (1 - α) * accel_gravity
```

- **Gyro** (high-pass): Accurate short-term, drifts long-term
- **Accel** (low-pass): Accurate long-term, noisy short-term
- **α** (gain): Typically 0.98 (98% gyro, 2% accel)

### 2. Roll and Pitch from Accelerometer

When stationary or constant velocity, accelerometer measures gravity:

```typescript
roll = atan2(accel_y, accel_z)
pitch = atan2(-accel_x, sqrt(accel_y² + accel_z²))
```

**Assumptions:**
- `|accel| ≈ 9.81 m/s²` (pure gravity, no dynamics)
- Body frame aligned with bike (X=forward, Y=left, Z=up)

**Problem:** During braking/cornering, accel includes linear forces → wrong roll/pitch from gravity.

### 3. Adaptive Trust

We modulate accel trust based on deviation from gravity:

```typescript
dynamics_factor = |accel_mag - 9.81| / 9.81
accel_trust = max(0.1, min(1.0, 1.0 - dynamics_factor / 4.0))
k_accel_adaptive = k_accel * accel_trust_smoothed
```

**Example:**
- Stationary: `|accel| = 9.81` → `trust = 1.0` → Full accel correction
- Braking 2 m/s²: `|accel| = 11.8` → `trust = 0.70` → Reduced correction
- Hard braking 5 m/s²: `|accel| = 14.8` → `trust = 0.27` → Mostly gyro

**Smoothing:** Trust is low-pass filtered (0.2 Hz) to prevent jittery fusion gains.

### 4. Bicycle Kinematics

For a bicycle turning at constant speed:

```
yaw_rate (ω_z) ≈ (v / L) * tan(roll)
```

Where:
- `v` = GPS velocity (m/s)
- `L` = wheelbase (~1.0 m for typical bike)
- `roll` = lean angle (rad)

**Usage:** Cross-check gyro_z against expected yaw rate. If error > 40 deg/s, gyro might be saturated → blend toward physics model (10% per sample).

**Limitations:**
- Assumes no skidding (valid for normal riding)
- Roll estimate must be accurate (otherwise wrong correction)
- Only applies during turns (roll ≠ 0) at speed > 2 m/s

---

## Implementation Details

### Initialization

**Problem:** First few samples may have unstable sensor readings (filters warming up, transient noise).

**Solution:** Wait for valid gravity vector before initializing orientation.

```typescript
if (!initialized && accel_mag > 5.0 m/s²) {
  // Valid gravity detected, initialize from accelerometer
  roll = atan2(accel_y, accel_z)
  pitch = atan2(-accel_x, sqrt(accel_y² + accel_z²))
  yaw = 0.0  // Unknown without magnetometer
  initialized = true
}
```

Until initialized, return neutral orientation (0, 0, 0) with zero trust.

### Preprocessing Filters

**Why filter BEFORE fusion?**
BNO055 does this internally - critical for stability. Without filtering, 3000+ deg/s gyro spikes cause unbounded integration.

**Filter Design:**

| Sensor | Cutoff Frequency | Rationale |
|--------|-----------------|-----------|
| Gyro | 10 Hz | Remove vibration (>10 Hz), preserve motion (<10 Hz) |
| Accel | 5 Hz | Clean gravity vector, remove road bumps |

**Implementation:** Exponential moving average (single-pole IIR filter):

```typescript
α = dt / (RC + dt)  where RC = 1 / (2π * f_cutoff)
filtered = α * new_value + (1 - α) * filtered_prev
```

**Computational cost:** ~6 multiply-adds per sample (negligible)

### Soft Constraints

**Hard clipping** (e.g., `roll = clamp(roll, -45°, 45°)`) causes:
- Discontinuous derivatives → filter instability
- Lost information during valid excursions

**Soft constraints** gently pull back excessive angles:

```typescript
if (|roll| > MAX_ROLL) {
  excess = |roll| - MAX_ROLL
  roll -= sign(roll) * excess * 0.1  // 10% correction per sample
}
```

**At 50 Hz:** 5 Hz correction bandwidth → smooth, non-disruptive

**Thresholds:**
- Roll: ±45° (extreme cornering, very steep camber)
- Pitch: ±30° (steep hills, ~58% grade)

### GPS Integration

**Yaw Drift Correction:**

Without magnetometer, yaw integrates gyro noise → unbounded drift (~3°/min typical).

**Solution:** Use GPS velocity heading as slow reference:

```typescript
if (gps.speed > 1.0 m/s) {
  yaw_error = normalize_angle(gps.heading - yaw)
  yaw += k_gps * yaw_error  // k_gps = 0.005 (slow correction)
}
```

**Time constant:** ~200 samples (4 sec at 50 Hz) to correct 1 radian (57°)

**Why slow?** GPS heading can jump during:
- Low speed (heading undefined below ~1 m/s)
- Signal loss (urban canyons, tunnels)
- Multipath (reflections from buildings)

Fast correction would introduce GPS noise into smooth gyro-based yaw.

**Physics Validation:**

During turns, cross-check gyro_z against bicycle kinematics:

```typescript
if (gps.speed > 2 m/s && |roll| > 5.7°) {
  expected_yaw_rate = (gps.speed / wheelbase) * tan(roll)
  yaw_rate_error = |gyro_z - expected_yaw_rate|

  if (yaw_rate_error > 40 deg/s) {
    // Gyro might be saturated, blend toward physics
    physics_yaw = yaw + expected_yaw_rate * dt
    yaw = 0.9 * yaw + 0.1 * physics_yaw
  }
}
```

**Why conservative?** Physics model assumes:
- Perfect roll measurement (may be wrong during dynamics)
- No skidding (valid for normal riding, not hard braking)
- Accurate GPS velocity (can have lag/noise)

Blending (10% correction) prevents overconfident physics-based updates.

---

## Firmware Configuration

### Sensor Mode

```cpp
bno.setMode(OPERATION_MODE_IMUPLUS);  // 6-DOF, no magnetometer
```

**Why no magnetometer?**
- **Interference:** Bike frame (steel/aluminum), passing cars, power lines, buildings
- **Calibration:** Requires slow figure-8 movements → impossible while riding
- **Errors:** Magnetic disturbances cause 10-30° yaw errors (worse than gyro drift)

**Trade-off:** Unbounded yaw drift, but consistent/predictable → GPS corrects it.

### Recorded Data

**Accelerometer:**
```cpp
imu::Vector<3> accel = bno.getVector(VECTOR_ACCELEROMETER);  // Raw, includes gravity
```

**Why raw?** Enables offline complementary fusion. BNO055 also offers `VECTOR_LINEARACCEL` (gravity removed), but that prevents custom fusion.

**Gyroscope:**
```cpp
imu::Vector<3> gyro = bno.getVector(VECTOR_GYROSCOPE);  // deg/s
```

**Units:** BNO055 outputs deg/s → convert to rad/s in filter.

### Brake Detection

**Important:** Brake detection (on-device, for tail light) uses `VECTOR_LINEARACCEL`:

```cpp
imu::Vector<3> accel_linear = bno.getVector(VECTOR_LINEARACCEL);
if (fabs(accel_linear.x) > BRAKE_THRESHOLD) {
  // Trigger brake light strobe
}
```

**Why?** Linear accel works at any pitch angle (gravity already removed by BNO055).

**Note:** Recording uses raw accel, brake detection uses linear → poll both vectors.

---

## Filter Tuning

### Gain Parameters

| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| `kAccel` | 0.02 | 0.005 - 0.05 | Accel correction strength (2%) |
| `kGyro` | 0.98 | 0.95 - 0.995 | Gyro weight (98%) |
| `kGPS` | 0.005 | 0.001 - 0.02 | GPS yaw correction speed |
| `minAccelTrust` | 0.1 | 0.05 - 0.3 | Minimum accel trust (prevents pure integration) |
| `gyroCutoff` | 10 Hz | 5 - 20 Hz | Gyro low-pass filter cutoff |
| `accelCutoff` | 5 Hz | 2 - 10 Hz | Accel low-pass filter cutoff |

### Tuning Guidelines

**More aggressive accel correction** (`kAccel` ↑ to 0.05):
- ✅ Faster convergence after errors
- ✅ Better long-term stability
- ❌ More noise from dynamics (braking/cornering)
- **Use case:** Smooth roads, gentle riding

**More conservative gyro trust** (`kGyro` ↑ to 0.995):
- ✅ Smoother short-term response
- ✅ Less affected by dynamics
- ❌ Slower long-term correction
- ❌ More drift accumulation
- **Use case:** Mountain biking, rough terrain

**Faster GPS yaw correction** (`kGPS` ↑ to 0.02):
- ✅ Reduces yaw drift faster
- ❌ GPS noise pollutes smooth gyro yaw
- **Use case:** Long rides where drift accumulates

**Tighter constraints** (`maxRoll` ↓ to 35°, `maxPitch` ↓ to 20°):
- ✅ Prevents extreme outliers
- ❌ Clips valid excursions (steep hills, hard cornering)
- **Use case:** Road cycling (vs. mountain biking)

### Filter Cutoff Frequencies

**Lower gyro cutoff** (5 Hz):
- ✅ Removes more vibration
- ❌ Delays fast rotations (may feel sluggish)
- **Use case:** Very rough terrain

**Higher gyro cutoff** (20 Hz):
- ✅ Faster response to turns
- ❌ Allows more vibration through
- **Use case:** Smooth roads, fast cornering

**Lower accel cutoff** (2 Hz):
- ✅ Very clean gravity vector
- ❌ Slow response to pitch/roll changes
- **Use case:** Steady riding, prioritize stability

**Higher accel cutoff** (10 Hz):
- ✅ Faster pitch/roll response
- ❌ More noise from bumps
- **Use case:** Dynamic riding, jumps

---

## Performance Characteristics

### Latency

| Component | Latency | Notes |
|-----------|---------|-------|
| Sensor sampling | 20 ms | 50 Hz BNO055 |
| Preprocessing filters | ~50 ms | 10 Hz cutoff → ~1.5 periods delay |
| Complementary fusion | <1 ms | Negligible (single pass) |
| GPS correction | ~200 ms | GPS update rate (5-10 Hz) |
| **Total end-to-end** | ~70 ms | Acceptable for cycling |

### Accuracy (Estimated)

| Metric | Typical | Notes |
|--------|---------|-------|
| **Roll accuracy** | ±2° | During constant velocity |
| **Roll (dynamics)** | ±5° | During braking/cornering |
| **Pitch accuracy** | ±3° | Sensitive to sustained braking |
| **Yaw drift rate** | 1-3°/min | Without GPS correction |
| **Yaw (with GPS)** | ±5° | GPS heading accuracy |

**Factors affecting accuracy:**
- Sensor calibration quality (BNO055 cal_sys status)
- Vibration magnitude (damping effectiveness)
- Dynamics intensity (braking, cornering G-forces)
- GPS quality (signal strength, multipath)

### Computational Cost

**Per-sample operations:**
- Gyro/accel filtering: 6 vectors × 3 axes × (2 multiply-adds) = **36 ops**
- Fusion: 3 angles × (1 atan2 + 1 multiply-add) = **~30 ops**
- Constraints: 2 checks × 4 ops = **8 ops**
- GPS correction: ~10 ops (when active)
- **Total:** ~84 operations/sample

**At 50 Hz:** 4200 ops/sec → negligible on modern CPU (<1% utilization)

---

## Known Limitations

### 1. Pitch Error During Braking on Descents

**Problem:**
On steep descent (pitch -20°), gravity adds 3.4 m/s² to X-axis. During braking (2 m/s²), total X-accel = -5.4 m/s², giving wrong pitch estimate from accelerometer.

**Current Mitigation:**
Adaptive trust reduces accel influence during dynamics (|accel| ≠ g).

**Future Improvement:**
Use GPS velocity change to estimate linear accel, subtract from measured accel to isolate gravity:

```typescript
linear_accel = d(gps.velocity) / dt
gravity_vector = accel_measured - linear_accel
pitch = atan2(-gravity_vector.x, ...)
```

**Challenge:** Requires accurate GPS synchronization and velocity differentiation (noisy).

### 2. Roll Error During Hard Cornering

**Problem:**
Cornering at 5 m/s with 30° roll → 2.8 m/s² lateral accel. Gravity vector tilted → wrong roll estimate.

**Current Mitigation:**
Trust reduction during |accel| ≠ g.

**Status:** Not yet solved. Requires understanding of cornering dynamics vs. gravity decomposition.

### 3. Yaw Drift Without GPS

**Problem:**
6-DOF mode (no magnetometer) → yaw integrates gyro bias → ~3°/min drift.

**Current Mitigation:**
GPS heading correction when speed > 1 m/s.

**Limitation:**
- Stationary: No GPS heading → pure drift
- Slow speed (<1 m/s): GPS heading unreliable
- GPS loss: Reverts to pure integration

**Future Improvement:**
- Static yaw estimation from accel/gyro cross-correlation
- Visual odometry (if camera available)
- Magnetometer soft-calibration (adaptive bias removal)

### 4. Gimbal Lock (Avoided)

**Problem:**
Euler angles suffer gimbal lock at pitch = ±90° (undefined roll/yaw).

**Mitigation:**
BNO055 provides quaternions → we convert to Euler after avoiding singularities:

```cpp
imu::Quaternion quat = bno.getQuat();
imu::Vector<3> euler = quat.toEuler();
```

**Limitation:** Cycling rarely exceeds ±60° pitch → gimbal lock unlikely, but algorithm is robust.

### 5. Filter Warm-Up

**Problem:**
Low-pass filters take ~3-5 time constants to settle (300-500 ms at 10 Hz cutoff).

**Mitigation:**
Wait for valid accel magnitude (>5 m/s²) before initializing orientation.

**Status:** Handled, but first 0.5s of recording may have unstable orientation.

---

## Future Improvements

### 1. Dynamics-Aware Trust

**Current:** Trust based on `|accel| - g` (magnitude only).

**Improvement:** Direction-aware trust:
- **Longitudinal accel** (X-axis): Affects pitch, expected during braking/acceleration
- **Lateral accel** (Y-axis): Affects roll, expected during cornering
- **Vertical accel** (Z-axis): Road bumps, mostly noise

**Approach:**
```typescript
// Estimate linear accel from GPS velocity change
linear_accel_long = d(gps.velocity) / dt
expected_accel_x = linear_accel_long + g * sin(pitch)

// If measured accel_x ≈ expected, trust is valid for pitch
pitch_trust = 1.0 - |accel_x - expected_accel_x| / g

// Roll less affected by longitudinal dynamics
roll_trust = 1.0 - |accel_mag - g| / g
```

**Benefit:** Maintain roll accuracy during braking, pitch accuracy during cornering.

### 2. Kalman Filter Implementation

**Current:** Complementary filter (simple, fast, tunable).

**Upgrade:** Extended Kalman Filter (EKF):
- Model sensor noise covariance
- Fuse GPS velocity, accel, gyro optimally
- Predict dynamics (linear accel, angular rates)
- Probabilistic confidence estimates

**Trade-offs:**
- ✅ Better accuracy in theory
- ✅ Optimal sensor fusion (MMSE estimator)
- ❌ More complex (state prediction, covariance propagation)
- ❌ Harder to tune (noise matrices)
- ❌ Computationally expensive (~10x)

**Status:** Deferred. Complementary filter is "good enough" for current use cases.

### 3. Machine Learning Calibration

**Idea:** Train neural network to predict orientation errors:

```
Input: [accel_x, accel_y, accel_z, gyro_x, gyro_y, gyro_z, gps_velocity, gps_heading]
Output: [roll_correction, pitch_correction, yaw_correction]
```

**Training data:** Ground truth from high-end IMU (e.g., VectorNav, XSens) on same bike.

**Benefit:** Learn complex dynamics (braking, cornering, bumps) → reduce errors.

**Challenges:**
- Need ground truth (expensive reference IMU)
- Generalization (different bikes, riders, terrains)
- Deployment (model inference on device vs. post-processing)

**Status:** Research idea, not implemented.

### 4. Terrain-Adaptive Tuning

**Idea:** Detect terrain type (smooth road, gravel, mountain trail) → adjust filter gains.

**Detection signals:**
- Accel variance (bumps)
- Gyro magnitude (rough handling)
- GPS speed (fast road vs. slow technical)

**Gain adjustments:**
- Smooth road: Higher `kAccel` (0.05), trust accel more
- Rough terrain: Lower `kAccel` (0.01), trust gyro more
- Stationary: Higher `kAccel` (0.1), fast convergence

**Status:** Not implemented. Requires terrain classifier.

### 5. Multi-IMU Fusion

**Idea:** Use multiple BNO055 sensors (e.g., on frame + wheel):
- Frame IMU: Body orientation
- Wheel IMU: Gyro saturation detection, suspension dynamics

**Benefit:** Detect when one gyro saturates (>2000 deg/s) → trust the other.

**Challenge:** Sensor synchronization, alignment calibration, cost.

**Status:** Not planned (single IMU sufficient for current use cases).

---

## Testing & Validation

### Unit Tests

**Signal processing:**
- ✅ Low-pass filter convergence (step response)
- ✅ Angle normalization (wrap to [-π, π])
- ✅ Quaternion ↔ Euler conversion

**Fusion logic:**
- ✅ Adaptive trust calculation
- ✅ Soft constraint behavior (pull-back rate)
- ✅ GPS interpolation (closest match within window)

**Location:** `/web/src/lib/imu/__tests__/`

### Integration Tests

**Scenario:** Simulated ride with known orientation:
- Straight line → roll=0°, pitch varies
- Turn left → roll increases, yaw rate matches bicycle kinematics
- Braking → accel magnitude increases, pitch stable

**Validation:** Compare filter output to ground truth (within tolerance).

**Status:** Not implemented (requires simulation framework).

### Field Testing

**Protocol:**
1. Record ride with firmware (VTX file)
2. Post-process with custom filter
3. Compare against BNO055 built-in orientation
4. Visualize in web app (roll, pitch, yaw charts)

**Metrics:**
- Yaw drift rate (deg/min without GPS)
- Roll/pitch RMS error (vs. BNO055 as reference)
- Subjective smoothness (visual inspection)

**Status:** Ongoing (user testing on hawk descent, townsley descent, etc.).

---

## References

### Complementary Filters
- Mahony, R. et al. (2008). "Complementary filter design on the special orthogonal group SO(3)."
- Madgwick, S. (2010). "An efficient orientation filter for IMU and MARG sensor arrays."

### Bicycle Dynamics
- Meijaard, J.P. et al. (2007). "Linearized dynamics equations for the balance and steer of a bicycle."
- Sharp, R.S. (2008). "On the stability and control of the bicycle."

### Sensor Fusion (General)
- Woodman, O.J. (2007). "An introduction to inertial navigation." (Cambridge, Tech Report)
- Groves, P.D. (2013). "Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems."

### BNO055 Documentation
- Bosch BNO055 Datasheet (Rev 1.6, 2023)
- Adafruit BNO055 Library: https://github.com/adafruit/Adafruit_BNO055

---

## Changelog

### Version 1.0 (2026-01-03)
- Initial documentation
- Firmware changed to record raw accel (instead of linear)
- Added smoothed trust to prevent jittery fusion
- Improved GPS interpolation (closest match within 1s window)
- Made bicycle physics validation less aggressive (blend 10% vs. replace)
- Comprehensive tuning guidelines and future improvements

---

## Contact

For questions or contributions:
- **Code:** `/web/src/lib/imu/bicycle-filter.ts`
- **Firmware:** `/firmware/imu_manager/sensor_manager.cpp`
- **Issues:** Open GitHub issue with tag `orientation-fusion`
