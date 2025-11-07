# Euler Angle Fix Summary

## What Was Fixed

**Problem:** Euler angles (roll, pitch, yaw) were accumulating unboundedly instead of staying within [-180°, 180°]

**Example from test data:**
- Roll: -4,747° to +4,864° (should be -180° to 180°)
- Pitch: -10,289° to +10,312° (should be -180° to 180°)
- Yaw: -10,307° to +10,306° (should be -180° to 180°)

## Solution Implemented

Added efficient angle normalization to `firmware/imu_manager/sensor_manager.cpp`:

**Modified files:**
1. `firmware/imu_manager/sensor_manager.cpp` - Added `normalizeAngle()` function and applied it to all euler angles
2. `firmware/imu_manager/sensor_manager.h` - Added function declaration

**Implementation:**
```cpp
float SensorManager::normalizeAngle(float angle) {
  // Normalize angle to [-180, 180] range using efficient modulo
  angle = fmodf(angle + 180.0f, 360.0f);
  if (angle < 0.0f) {
    angle += 360.0f;
  }
  return angle - 180.0f;
}
```

This uses `fmodf()` for efficiency instead of a while loop.

## Why Quaternion→Euler?

You mentioned the BNO055 has a bug with native Euler angles at >20°. This is correct!

**BNO055 Native Euler Issues:**
- Bug/inaccuracy at angles >20°
- Problematic for cycling: bikes lean 20-45° in corners, pitch 10-20°+ on hills

**Quaternion→Euler Advantages:**
- ✅ No gimbal lock
- ✅ No sensor-specific bugs
- ✅ Works at all angles
- ✅ BNO055's quaternion output is reliable (from sensor fusion)

**Decision:** Keep quaternion→euler conversion, just add normalization.

## Next Steps

### 1. Flash Updated Firmware
```bash
# Use Arduino IDE or PlatformIO to upload to your device
```

### 2. Test with New Recording
Record a 5-10 minute test ride with varied conditions:
- Multiple turns (left and right)
- Hill climbing/descending if possible
- Some straight sections

### 3. Validate the Fix
```bash
cd analysis
source ../venv-analysis/bin/activate
python validate_euler_angles.py
```

**Expected results:**
- Roll: [-45°, +45°] typical range for cycling
- Pitch: [-20°, +20°] typical range (depends on hills)
- Yaw: [-180°, +180°] full heading range
- No discontinuities >180° (except legitimate boundary crossings at ±180°)

### 4. Verify in Visualization
Check the generated PNG file - angles should now:
- Stay bounded within [-180°, 180°]
- Show clear oscillations for turns (roll)
- Show gradual changes for hills (pitch)
- Show smooth heading changes (yaw)

## What This Enables

With properly normalized euler angles, you can now:

1. **Accurate turn detection** - roll angle directly shows bike lean
2. **Heading tracking** - yaw shows compass direction/navigation
3. **Hill grade estimation** - pitch combined with accel gives road grade
4. **World-frame acceleration** - transform accel from bike frame to world frame
5. **Better visualizations** - angles make sense and are comparable across rides

## Files Modified

```
firmware/imu_manager/sensor_manager.cpp  [MODIFIED]
firmware/imu_manager/sensor_manager.h    [MODIFIED]
```

## Test Results Available

- ✅ Validation report: `analysis/SENSOR_FUSION_VALIDATION_REPORT.md`
- ✅ Visualization: `analysis/data/sample-recordings/pedro_to_home_euler_angles.png`
- ✅ Test script: `analysis/validate_euler_angles.py`

---

**Status:** ✅ Ready to flash and test
