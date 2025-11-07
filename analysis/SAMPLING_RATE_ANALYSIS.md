# Sampling Rate Strategy Analysis

## Research Findings

### 1. Bicycle Dynamics Requirements (Low Frequency)

**Motorcycle IMUs: 100 Hz standard**
- Cornering ABS
- Lean angle
- Traction control
- Stability systems

**Human Movement Research:**
- Walking: 100 Hz sufficient
- Running: 200 Hz sufficient
- High-speed cyclic movements: 400 Hz

**Bicycle dynamics are SLOW:**
- Lean angle changes: 1-5 Hz (turning takes ~1-2 seconds)
- Acceleration/braking: 0.5-2 Hz (events last seconds)
- Body movement: 1-3 Hz

**Conclusion:** **20-50 Hz is PLENTY for all bicycle dynamics**

---

### 2. Road Surface Classification (High Frequency - THE GOLDMINE!)

**Critical Discovery:** The "noise" is actually VALUABLE DATA!

Studies show 93.4% accuracy distinguishing:
- ✅ Normal pavement
- ✅ Potholes
- ✅ Bad road surface
- ✅ Speed bumps
- ✅ Gravel vs pavement
- ✅ Road roughness index

**Vibration signatures:**
- Different surfaces have unique frequency spectra
- Power spectral density (PSD) distinguishes surface types
- Machine learning classifies road conditions from accelerometer

**Key frequencies:**
- Road texture: 40-160 Hz (dominant 40-60 Hz)
- Surface anomalies: Sharp transients + harmonics
- Gravel: Higher frequency, more random

**Sampling rate needed:**
- Nyquist: 2x highest frequency = 320 Hz minimum
- Practical: 400-500 Hz for clean capture
- Your BNO055 max: ~100 Hz (even when configured to 1000 Hz)

---

## The Problem: You Can't Have Both With BNO055

### Option A: Low Sample Rate (20-50 Hz) - Bicycle Dynamics
**Captures:**
- ✅ Lean angle (roll)
- ✅ Pitch (hills)
- ✅ Heading (yaw)
- ✅ Acceleration/braking
- ✅ Turning events
- ✅ GPS-quality position tracking

**Misses:**
- ❌ Road surface classification
- ❌ Vibration analysis
- ❌ Pavement quality
- ✅ **AVOIDS vibration aliasing** (this is good!)

**Recommended: 25 Hz** (well below 40 Hz vibration floor)

### Option B: High Sample Rate (100+ Hz) - Road Surface Analysis
**Captures:**
- ✅ Road vibration signature (partial, up to ~50 Hz Nyquist)
- ✅ Basic surface classification (smooth vs rough)
- ✅ Pothole/bump detection
- ⚠️ Still missing 60-160 Hz content (undersampled)

**Problems:**
- ❌ 40-60 Hz vibration STILL aliases into measurements
- ❌ Gyro still saturates (±7000 deg/s nonsense)
- ❌ Orientation (roll/pitch/yaw) corrupted by vibration
- ❌ Larger files, more power

**BNO055 Limitation:** Fusion mode locks bandwidth at 32-62 Hz
- Can't filter out road vibration
- Can't increase sensor bandwidth
- Aliasing is UNAVOIDABLE at any sample rate

---

## Recommended Strategy: DUAL APPROACH

### Phase 1: Get Orientation Working (NOW)
**Sample Rate: 25 Hz**

Why 25 Hz?
- 2.5x higher than bicycle dynamics (10 Hz max)
- Well below 40 Hz vibration floor (no aliasing)
- Matches GPS update rates (smooth fusion)
- 40ms between samples is PLENTY for lean angle
- Small files, low power

**What you get:**
- Clean roll/pitch/yaw (no vibration corruption)
- Accurate lean angles for cornering
- Acceleration/braking events
- Turn detection
- Hill grade from pitch
- Heading/navigation

**What you lose:**
- Road surface classification (accept this for now)

### Phase 2: Add Dedicated High-Frequency Accelerometer (FUTURE)
For road surface analysis, add a second sensor:
- Raw high-speed accelerometer (500-1000 Hz)
- NO gyro/mag/fusion (just accel)
- Log separately or downsample features
- Examples: ADXL355 (4000 Hz), LIS3DH (5000 Hz)

**Why separate sensors?**
- BNO055 fusion can't handle high sample rates
- Road vibration destroys orientation accuracy
- Different data rates for different purposes
- Many systems do this (motorcycles have 2-3 IMUs)

---

## Your Questions Answered

### "Will 20 Hz give us most IMU features?"
**YES!**
- Braking/accel: ✅ (happens over 1-3 seconds)
- Cornering: ✅ (turns take 1-2 seconds)
- Lean angles: ✅ (changes at 1-5 Hz)
- All "long term actions": ✅ (that's the point!)

20 Hz = 50ms resolution. A 45° lean over 1 second is sampled 20 times. Perfect.

### "What can we still interpret from road noise?"
At 20-25 Hz? **Nothing useful for surface classification.**
- You're below Nyquist for 40-160 Hz vibration
- The aliased noise is just corruption, no information

BUT: You can detect **large transients**:
- Potholes (sharp spike)
- Speed bumps (big bump)
- Major surface changes (RMS change)

Think: "bump detector" not "surface classifier"

### "Can we tell pavement from gravel?"
**At 25 Hz: NO** - frequency signatures are above your Nyquist
**At 100 Hz: MAYBE** - partial signature, need ML
**At 500 Hz: YES** - full spectral analysis possible

### "Good road vs bad?"
**At 25 Hz: YES!** (barely)
- Measure RMS of acceleration over time windows
- High RMS = rough, Low RMS = smooth
- This is a scalar quality metric, not classification
- Same principle as phone-based "road roughness" apps

### "What about 100 Hz?"
**Worst of both worlds:**
- Still below Nyquist for full vibration spectrum (need 320 Hz)
- Still suffers from aliasing (40-60 Hz folds into 0-50 Hz)
- Gyro still saturates from vibration
- Orientation accuracy degraded
- Larger files, more power

**100 Hz makes sense ONLY if:**
- You give up on orientation accuracy
- You accept aliased/partial vibration data
- You use ML to classify despite artifacts

---

## Recommendation

### Firmware Change: 25 Hz (not 20, not 100)

**Why 25 Hz specifically?**
- Clean multiple of 50/60 Hz AC noise
- Below vibration band (reduces aliasing)
- Sufficient for all bicycle dynamics
- Power of 2 for BLE efficiency considerations
- Standard rate for consumer IMU applications

**Implementation:**
```cpp
sampleIntervalMs = 40;  // 25 Hz = 40ms between samples
```

### Get Proof of Concept Working
1. ✅ Normalize angles (already done)
2. 🔧 Set 25 Hz sample rate
3. 🔧 Add mechanical damping (foam + mass)
4. 🧪 Record 5-minute test
5. 📊 Validate clean orientation data

### Future Enhancement: Road Surface
Once orientation is working:
- Add high-speed accelerometer (separate sensor)
- Log vibration at 500+ Hz
- Build ML classifier for surfaces
- Combine low-freq orientation + high-freq vibration

---

## Bottom Line

**You can't extract road surface information at reasonable sample rates with the BNO055** because:
1. Fusion mode locks sensor bandwidth too low
2. Road vibration is too high frequency (40-160 Hz)
3. High sample rates destroy orientation accuracy

**Solution:** Get orientation working first at 25 Hz, add dedicated vibration sensor later.

The BNO055 is excellent for orientation but wrong tool for vibration analysis.
