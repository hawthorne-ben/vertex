# Quick Calibration Guide

## Your Current Status (from dashboard)

- **Gyro**: ✅ 3 (Calibrated)
- **Accel**: ⚠️ 1 (Partially calibrated) ← Improve this
- **System**: ❌ 0 (Not calibrated) ← Improve this
- **Mag**: ❌ 0 (Not calibrated) ← Improve this

## To Improve Accelerometer Calibration

**Current**: Accel = 1 (partial)
**Target**: Accel = 3 (full)

**What to do**:
1. While sensor is running and showing in dashboard
2. **Tilt sensor slowly** through different orientations:
   - Hold up
   - Hold down
   - Hold left (lean it)
   - Hold right (lean it)
   - Tilt forward
   - Tilt backward
3. Go through all 6 positions slowly
4. Takes about 10-15 seconds of movement
5. Watch "ACCEL" value in calibration card go from 1 → 2 → 3

## To Calibrate Magnetometer (Optional)

**Current**: Mag = 0
**Target**: Mag = 3

**What to do**:
1. Hold sensor in your hand
2. Make large figure-8 patterns in the air
3. Do this 10-15 times
4. Watch "MAG" value increase from 0 → 1 → 2 → 3

**Why bother?**: Magnetometer helps with yaw (heading/north direction) accuracy

## System Calibration

**Current**: System = 0
**Target**: System = 3

**What to do**: Nothing! This automatically becomes 3 once all other sensors are calibrated.

## Quick Steps to Full Calibration

1. **Keep sensor still** (Gyro should already be 3)
2. **Tilt sensor slowly** through 6 orientations (Accel should go to 3)
3. **Wave in figure-8s** (Mag should go to 3)
4. **System will automatically** become 3

## Total Time Required

- About 30 seconds of movement total
- No need to restart or power cycle
- Results are immediate (watch dashboard)

## After Calibration

Your data will be:
- ✅ More accurate pitch/roll angles
- ✅ Better acceleration readings
- ✅ More accurate yaw/heading (if you calibrated magnetometer)

## Why I2C Errors Don't Matter (For Now)

The errors you're seeing are being handled by the firmware:
- Sensors continue to work despite errors
- Data is still being read
- Recovery happens automatically
- Dashboard continues to update

**You can ignore the I2C errors** unless they're causing actual problems (like data not updating).

If they bother you, check:
- STEMMA QT cable fully seated?
- Battery charged? USB power connected?
