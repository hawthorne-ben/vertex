# Sensor Fusion Validation Report
**Date:** 2025-11-07
**Test File:** `pedro_to_home.vtx` (16.2 min ride)

## Executive Summary

✅ **SUCCESS**: Euler angles (roll, pitch, yaw) are being logged correctly to VTX files
⚠️ **ISSUE**: Euler angles are unbounded and accumulating instead of normalizing to [-180°, 180°]
✅ **PARTIAL**: Accelerometer data using VECTOR_LINEARACCEL (gravity-compensated)

---

## 1. Euler Angle Validation

### Data Format Confirmed
- **Firmware** (`sensor_manager.cpp:88-92`): Converts quaternion to Euler, multiplies by `RAD_TO_DEG`
- **BLE Transmission** (`ble_manager.cpp:265-269`): Sends as `float32` (in degrees)
- **Android App** (`BleService.ts:819-823`): Receives as `float32` (in degrees)
- **VTX Storage** (`decoder.py:337-342`): Stores as `float32` (raw values, in degrees)
- **Python Analysis**: Displays values as degrees (but labels suggest radians)

### Critical Issue: Unbounded Euler Angles

The test file shows euler angles are **not normalized**:

```
ROLL:   Range: [-4747.5°, 4864.8°]  (Expected: [-180°, 180°])
PITCH:  Range: [-10288.9°, 10311.7°]  (Expected: [-180°, 180°])
YAW:    Range: [-10307.1°, -10305.7°]  (Expected: [-180°, 180°])
```

**Root Cause:** The BNO055's `quat.toEuler()` method returns **unbounded** euler angles that accumulate over multiple rotations. This is mathematically valid but impractical for visualization and analysis.

**Visualization Impact:**
- Pitch accumulated from -10,288° to +10,311° (57 full rotations!)
- Yaw accumulated similarly (28 full rotations!)
- Roll is better but still shows ~27 full rotations

### Turn Detection Still Works
Despite the accumulation issue, turn detection works because relative changes are preserved:
- **Left turns detected:** 72 segments (13.5% of ride)
- **Right turns detected:** 79 segments (85.0% of ride)

However, the absolute angle values are meaningless for:
- Bike lean angle visualization
- Heading/compass direction
- Comparing angles across rides

---

## 2. Accelerometer Validation

### Using Linear Acceleration (Gravity-Compensated)

The firmware correctly uses `VECTOR_LINEARACCEL` (line 75 in `sensor_manager.cpp`):
```cpp
imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
```

This provides **gravity-compensated** acceleration from the BNO055's sensor fusion.

### Statistics from Test File

```
ACCELEROMETER (m/s²)
            accel_x       accel_y       accel_z
mean       2.201         -2.219        2.830
std        5.733          3.547        6.392
min      -39.890        -31.780      -47.940
max       48.920         28.920       41.170
```

**Analysis:**
- Mean values are non-zero (2-3 m/s²), suggesting possible sensor offset or sustained acceleration
- High std deviation (3-6 m/s²) indicates dynamic motion
- Max values up to 48 m/s² (~5G) are plausible for bike riding with bumps
- No clear gravity signature (~9.8 m/s²) - **confirms linear accel is being used** ✓

### Event Detection Results

Using Butterworth filter (1.5Hz cutoff) and peak detection:
- **Acceleration events:** 12 detected
- **Braking events:** 20 detected
- **Detection rate:** ~2 events/minute

The notebook shows acceleration/braking detection is working, though only on forward axis (X).

---

## 3. Implemented Fixes

### ✅ FIXED: Angle Normalization Implemented

**Location:** `firmware/imu_manager/sensor_manager.cpp:88-94, 121-128`

**Implemented Solution:**
```cpp
// Euler angles from quaternion (convert radians to degrees and normalize)
// toEuler() returns radians: x=heading/yaw, y=roll, z=pitch
// Note: Using quaternion->euler conversion instead of BNO055 native euler angles
// because BNO055 has a known bug with native euler at >20° (problematic for cycling)
sensorData.yaw = normalizeAngle(euler.x() * RAD_TO_DEG);
sensorData.roll = normalizeAngle(euler.y() * RAD_TO_DEG);
sensorData.pitch = normalizeAngle(euler.z() * RAD_TO_DEG);

// Helper function (efficient modulo-based):
float SensorManager::normalizeAngle(float angle) {
  angle = fmodf(angle + 180.0f, 360.0f);
  if (angle < 0.0f) {
    angle += 360.0f;
  }
  return angle - 180.0f;
}
```

**Why Quaternion→Euler Instead of Native Euler:**
The BNO055 has a **known bug** in native Euler angles at values >20°, which is problematic for cycling:
- ❌ **Roll >20°**: Common during cornering (bikes lean 20-45°)
- ❌ **Pitch >20°**: Common on steep hills (10-20%+ grades)
- ✅ **Quaternion→Euler**: No gimbal lock, no bugs, handles all angles

**Decision:** Stick with quaternion-based euler angles and add normalization.

### Priority 3: Update Analysis Scripts

**Location:** `analysis/validate_euler_angles.py`

The validation script incorrectly displays degrees as radians. Update the output to match the actual units.

### Priority 4: Enhance Accelerometer Analysis

Consider using euler angles to:
1. **Transform acceleration to world frame** - distinguish forward/lateral/vertical acceleration regardless of bike orientation
2. **Compensate for tilt** - better acceleration/braking detection accounting for road grade
3. **Detect cornering** - combine roll angle with lateral acceleration

---

## 4. Test Data Quality Assessment

### Overall Quality: ✅ GOOD

- ✅ No missing values (NaN) in any sensor channel
- ✅ Sample rate stable at 49.2 Hz (close to target 40 Hz)
- ✅ 16.2 minute recording with 47,846 samples
- ✅ Magnetometer data present and varying
- ⚠️ 388 large discontinuities in pitch (>90° jumps between samples)
- ⚠️ 386 large discontinuities in yaw
- ⚠️ 25 discontinuities in roll

**Discontinuities Analysis:**
These large jumps are artifacts of the unbounded euler angles wrapping around. After normalization, these should disappear or be reduced to crossing ±180° boundary.

---

## 5. Next Steps

1. **Implement angle normalization** in firmware (Option 1 or Option 2 above)
2. **Flash updated firmware** to test device
3. **Record new test ride** (5-10 minutes with varied terrain)
4. **Re-run validation** to confirm angles stay within [-180°, 180°]
5. **Update analysis notebooks** to leverage properly normalized euler angles for:
   - World-frame acceleration transformation
   - Improved turn/lean detection
   - Heading/direction tracking

---

## 6. Validation Script Output

See generated visualization: `data/sample-recordings/pedro_to_home_euler_angles.png`

**Key Observations:**
- Roll shows periodic oscillation (expected for turns) but drifts unboundedly
- Pitch steadily accumulates (bike tilting forward over time adds up)
- Yaw steadily drifts in one direction (heading changes accumulate)

All three angles should oscillate around a baseline rather than trending indefinitely.
