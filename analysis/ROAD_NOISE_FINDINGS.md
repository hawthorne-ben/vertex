# Road Noise Analysis - Critical Findings

## Your Intuition Was Correct

You were right to question the data! The pedro_to_home.vtx recording shows **gyro saturation from road vibration**, not actual bike rotation.

## The Smoking Gun

```
Gyroscope readings:
X-axis: ±4,645 deg/s  (±13 full rotations per second!)
Y-axis: ±7,252 deg/s  (±20 full rotations per second!)
Z-axis: ±4,945 deg/s  (±14 full rotations per second!)

For reference:
- Fast bike turn: ~50-100 deg/s
- Your data: 100x higher → IMPOSSIBLE
```

**Conclusion:** The BNO055 gyro is being saturated by high-frequency road vibration (40-160 Hz), not measuring actual rotation.

---

## Root Cause: Frequency Band Collision

### Road Bike Vibration Spectrum
- **Primary band:** 40-60 Hz (tire/wheel natural frequency)
- **Extended band:** 0-160 Hz (road roughness)
- **Tire pressure effect:** Minimal (60-120 psi shifts peak by only 2 Hz)

Your 32c tires at 70 psi are RIGHT in the typical range.

### BNO055 Limitations (Fusion Mode)
- **Gyro bandwidth:** 32 Hz (FIXED, cannot change)
- **Accel bandwidth:** 62.5 Hz (FIXED, cannot change)
- **Your sample rate:** 49.2 Hz

**THE PROBLEM:**
```
Road vibration:    40-160 Hz  ← Signal you DON'T want
Gyro bandwidth:       32 Hz   ← Can't filter it out!
Sample rate:          49 Hz   ← Nyquist = 24.5 Hz
                               ← Everything above 24.5 Hz ALIASES into measurement
```

The 40-160 Hz vibration is **aliasing** down into your measurement band, appearing as fake rotation.

---

## Why Quaternions Didn't Save You

Research confirms:
- ✅ Quaternions prevent gimbal lock
- ✅ Quaternions are computationally efficient
- ❌ **BUT:** "Real MEMS gyroscope readings are noisy and sensitive to vibrations"

**Quaternion math is perfect. Your gyro data is garbage.**

The BNO055 sensor fusion integrates gyro data into quaternions. If gyro sees ±7,000 deg/s vibration noise, the quaternion accumulates it as rotation. No amount of math fixes bad input.

---

## The Turn Count Was Wrong

You were right not to trust "43.7% left turns, 51.7% right turns."

Those aren't turns - that's **vibration noise wrapping through ±180°** after normalization. The data is fundamentally corrupted.

---

## What CAN You Get From Road Noise?

Research shows vibration analysis CAN distinguish:
- ✅ Pavement vs gravel (93.4% accuracy)
- ✅ Good road vs bad road
- ✅ Potholes, bumps, surface anomalies
- ✅ Road roughness index

**BUT** this requires:
1. **High sample rate:** 400-500 Hz minimum (2x Nyquist for 160 Hz)
2. **Raw accelerometer data:** No sensor fusion
3. **Frequency domain analysis:** FFT, power spectral density
4. **Machine learning:** Classify vibration signatures

**Your BNO055 can't do this because:**
- Max ~100 Hz sample rate (even when configured to 1000 Hz)
- Fusion mode locks bandwidth at 32-62 Hz
- Orientation accuracy degrades with high-frequency content

---

## The Solution: Two Different Missions

### Mission 1: Bicycle Dynamics (LOW FREQUENCY) ← DO THIS NOW
**Target:** Clean orientation, acceleration, navigation

**Requirements:**
- Roll/pitch/yaw for lean, hills, heading
- Acceleration for braking/cornering g-forces
- Sample rate: **25 Hz is PLENTY**

**Why 25 Hz?**
- Bicycle dynamics are 1-5 Hz (turns take 1-2 seconds)
- 25 Hz = 5-25x oversampling (perfect)
- Well below 40 Hz vibration floor (reduces aliasing)
- Matches GPS update rates (10-20 Hz)

**Analogy:** You don't need 4K video to watch someone walk. 25 fps is plenty.

### Mission 2: Road Surface Analysis (HIGH FREQUENCY) ← ADD LATER
**Target:** Surface classification, roughness, quality

**Requirements:**
- High-speed raw accelerometer (500-1000 Hz)
- NO sensor fusion (just accel)
- Separate logging or feature extraction
- ML classifier

**Recommended sensor:** ADXL355, LIS3DH, or similar high-speed accel

**Why separate?**
- Different data rates for different purposes
- Can't do both with one BNO055
- Motorcycles use 2-3 IMUs for this reason

---

## Your Questions Answered

### "Will 25 Hz give us most IMU features we'd expect?"

**YES - ALL the important ones:**

| Feature | Required Hz | 25 Hz Adequate? |
|---------|-------------|-----------------|
| Lean angle (roll) | 1-5 Hz | ✅ YES (5-25x oversampled) |
| Hills (pitch) | 0.1-1 Hz | ✅ YES (25-250x oversampled) |
| Heading (yaw) | 0.1-2 Hz | ✅ YES (12-250x oversampled) |
| Braking | 0.5-2 Hz | ✅ YES (12-50x oversampled) |
| Acceleration | 0.5-2 Hz | ✅ YES (12-50x oversampled) |
| Cornering G-forces | 0.5-3 Hz | ✅ YES (8-50x oversampled) |

Motorcycle racing systems use 100 Hz and they're doing 200+ mph with instant response. You're on a bicycle at 15-30 mph. **25 Hz is MORE than enough.**

### "What can we still interpret from road noise at 25 Hz?"

**Large transients ONLY:**
- ✅ Potholes (big spike)
- ✅ Speed bumps (big bump)
- ✅ Major surface changes (RMS energy change)
- ✅ Rough road quality (high RMS = rough)

Think: **"Bump detector"** not **"Surface classifier"**

You can compute:
```python
# Road roughness index
rms_accel = np.sqrt(np.mean(accel_vertical**2))
# High RMS = rough, Low RMS = smooth
```

This is what phone-based "road roughness" apps do at GPS rates (1-10 Hz).

### "Can we tell pavement from gravel?"

**At 25 Hz: NO**
- Frequency signatures are 40-160 Hz
- You're below Nyquist (12.5 Hz cutoff)
- Information simply isn't there

**Need:** 400+ Hz with raw accelerometer

### "Good road vs bad road?"

**At 25 Hz: YES** (barely)
- RMS of vertical acceleration
- Scalar quality metric: 0-10 roughness score
- NOT surface type classification
- Good enough for ride logging

### "What about 100 Hz?"

**Worst of both worlds:**
- ❌ Still undersampled for full vibration (need 320 Hz)
- ❌ Still suffers from 40-60 Hz aliasing
- ❌ Gyro still saturates
- ❌ Orientation accuracy degraded
- ❌ 4x larger files
- ❌ 4x more power

**100 Hz only makes sense if:**
- You give up on clean orientation
- You're doing ML on partial/aliased vibration data
- You accept noisy roll/pitch/yaw

---

## Implementation: 25 Hz + Mechanical Damping

### 1. Firmware Changes (DONE ✅)
```cpp
// config.h
#define DEFAULT_SAMPLE_INTERVAL_MS 40  // 25 Hz

// sensor_manager.cpp
float normalizeAngle(float angle) {
  angle = fmodf(angle + 180.0f, 360.0f);
  if (angle < 0.0f) angle += 360.0f;
  return angle - 180.0f;
}

sensorData.yaw = normalizeAngle(euler.x() * RAD_TO_DEG);
sensorData.roll = normalizeAngle(euler.y() * RAD_TO_DEG);
sensorData.pitch = normalizeAngle(euler.z() * RAD_TO_DEG);
```

### 2. Mechanical Damping (TODO - CRITICAL!)

From BNO055 forums: "For vibration applications, mount sensor on a mass (brass/stone) and wrap in soft foam"

**Why this works:**
- Mass increases inertia (low-pass mechanical filter)
- Foam attenuates high frequencies (40-160 Hz)
- Preserves low frequencies (0-10 Hz bike motion)

**DIY approach:**
1. Mount BNO055 board on a ~50g brass/steel block
2. Wrap block in soft foam (1-2cm thick)
3. Mount foam assembly to bike frame
4. Test on smooth road first, then rough

**Target:** Reduce 40-160 Hz vibration by 20+ dB

### 3. Test Protocol
1. Flash updated firmware (25 Hz + normalization)
2. Add mechanical damping
3. Record 5-minute test ride (varied conditions)
4. Check gyro readings: should be <200 deg/s, not ±7,000!
5. Check euler angles: should stay in reasonable ranges

---

## Expected Results After Fix

### Bad Recording (current pedro_to_home.vtx)
```
Gyro: ±7,000 deg/s   ← SATURATED
Roll: -4,747° to +4,864°  ← UNBOUNDED
Turn count: Meaningless  ← NOISE
```

### Good Recording (after fixes)
```
Gyro: ±200 deg/s     ← Reasonable for cycling
Roll: -30° to +30°   ← Typical lean angles
Pitch: -10° to +10°  ← Typical hills
Yaw: Smooth heading  ← Clean navigation

Detectable events:
- Turn detection: ✅ (roll threshold)
- Braking: ✅ (forward decel)
- Acceleration: ✅ (forward accel)
- Hills: ✅ (pitch + accel)
- Major bumps: ✅ (transients)
```

---

## Future: Add Road Surface Sensor

Once orientation is working, add dedicated vibration sensor:

**Option 1: ADXL355 (Analog Devices)**
- 4000 Hz sample rate
- ±2/4/8g ranges
- Low noise (20 µg/√Hz)
- SPI interface
- ~$30

**Option 2: LIS3DH (STMicro)**
- 5376 Hz sample rate
- ±2/4/8/16g ranges
- Ultra low power
- I2C/SPI
- ~$5

**Implementation:**
- Log high-speed accel to separate file/buffer
- Downsample or extract features (RMS, FFT bands)
- Combine with BNO055 orientation data
- Build ML classifier offline

---

## Bottom Line

### Current State
- ❌ Data corrupted by vibration
- ❌ Gyro saturated (±7,000 deg/s impossible)
- ❌ Orientation unusable
- ❌ Turn analysis meaningless

### After Fixes (25 Hz + damping + normalization)
- ✅ Clean orientation (roll/pitch/yaw)
- ✅ Lean angles for cornering
- ✅ Braking/acceleration events
- ✅ Turn detection
- ✅ Hill grade tracking
- ✅ Basic road quality (RMS)
- ⚠️ No surface type classification (accept limitation)

### Future Addition (high-speed accelerometer)
- ✅ Everything above, PLUS:
- ✅ Pavement vs gravel detection
- ✅ Road surface classification
- ✅ Detailed roughness analysis

**Next Steps:**
1. ✅ Flash firmware (normalization + 25 Hz)
2. 🔧 Add mechanical damping
3. 🧪 Test ride (5 minutes)
4. 📊 Validate clean data
5. 🎉 Start building features!

The proof of concept is within reach. The BNO055 can give you excellent orientation data - you just need to keep vibration out of it.
