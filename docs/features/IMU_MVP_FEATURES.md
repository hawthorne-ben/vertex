# IMU Data Analysis MVP - Commercial Feature Set

**Last Updated:** January 10, 2026
**Status:** Ready for Implementation
**Hardware:** BNO055 IMU @ 25Hz + GPS @ 1Hz + Barometer

---

## Executive Summary

Based on technical analysis of sensor capabilities and commercial viability, this document defines the MVP feature set for Vertex IMU cycling analytics. The focus is on **unique, high-value insights** that competitors (Strava, Garmin, Komoot) cannot provide, while acknowledging the fundamental limitations of consumer-grade IMU hardware.

**Core Strategy:** Stop chasing perfect orientation. Build unique insights from imperfect data.

---

## Hardware Capabilities & Limitations

### ✅ What We CAN Measure Reliably

| Metric | Accuracy | Update Rate | Notes |
|--------|----------|-------------|-------|
| **Roll (lean angle)** | ±3-5° | 25 Hz | Drift doesn't affect peak measurements |
| **Short-term accel** | ±0.2 m/s² | 25 Hz | <1s events accurate, vibration filterable |
| **Yaw (relative)** | ±5-10° | 25 Hz | GPS provides drift correction every 1s |
| **Road roughness** | Relative only | 25 Hz | RMS-based scoring, 0-10 scale |
| **GPS speed** | ±0.1-0.2 m/s | 1 Hz | From Coros/phone |
| **GPS heading** | ±5-10° | 1 Hz | Accurate at speed (>5 mph) |
| **Barometric grade** | ±0.5-1% | 1 Hz | Much better than GPS altitude |

### ❌ What We CANNOT Measure Reliably

| Metric | Why Not | Alternative |
|--------|---------|-------------|
| **Sustained pitch** | Drift 5-15°/min during dynamics | Use GPS + barometer for grade |
| **Absolute orientation** | Gyro drift, no mag reference | Use relative changes only |
| **Surface classification** | Need 400+ Hz sampling | Roughness score instead |
| **Sub-second GPS** | Hardware limit (1 Hz) | Interpolate with IMU |

**Key Insight:** Drift affects **absolute baseline**, not **relative changes**. We measure deltas (turn entry → apex), not absolutes.

---

## Phase 1: Gold Tier Features (MVP Launch)

### 1. Cornering Performance Analytics 🏆

**Value Proposition:** "See your cornering performance like a MotoGP racer"

**What We Measure:**
- Max lean angle per turn (degrees)
- Lateral G-force at apex
- Turn entry/exit speed (from GPS)
- Turn duration and sharpness
- Cornering line consistency (multiple laps)

**Technical Implementation:**
```
Data: Roll angle (25 Hz) + GPS heading change (1 Hz)
Algorithm:
  1. Detect turn: GPS heading delta >15° over 2s window
  2. Find peak lean: max(abs(roll)) during heading change
  3. Calculate lateral G: roll_angle × velocity² / radius
  4. Smooth score: Penalize harsh roll rate changes

Accuracy: ±3-5° lean angle (drift doesn't affect peak)
```

**UI/Display:**
- Map overlay: Color-code turns by lean angle (green=gentle, red=aggressive)
- Turn-by-turn breakdown: "Turn 12: 32° lean, 18 mph, 0.6g lateral"
- Leaderboard: "Your best corner: Hawk hairpin (32°)"
- Comparison: Overlay multiple descents, show ideal line

**Commercial Differentiation:**
- ❌ Strava: No lean angle data
- ❌ Garmin: No lean angle data
- ✅ Vertex: Only cycling app with cornering analytics
- 💰 Comp: Motorcycle apps charge $10/month for this

---

### 2. Braking Analysis & Safety Scoring

**Value Proposition:** "Optimize your descending, improve your safety score"

**What We Measure:**
- Braking event detection (when, where, how hard)
- Harsh braking count (>3 m/s² deceleration)
- Braking heatmap on route
- "Smooth score" (0-100)

**Technical Implementation:**
```
Data: Forward accel (25 Hz) + GPS position (1 Hz)
Algorithm:
  1. Low-pass filter: 5 Hz cutoff (removes vibration)
  2. Detect braking: accel_x < -2.5 m/s² for >0.3s
  3. Classify severity:
     - Gentle: -2.5 to -3.5 m/s²
     - Moderate: -3.5 to -4.5 m/s²
     - Harsh: >-4.5 m/s²
  4. Map to GPS coordinates

Accuracy: 80-90% detection rate (vibration false positives <10%)
```

**UI/Display:**
- Route map: Red dots where you braked
- Stats panel: "47 braking events (8 harsh)"
- Smooth score: 100 - (harsh_brakes × 5) - (moderate_brakes × 2)
- Recommendations: "Try smoother speed control into turn 5"

**Commercial Applications:**
- Training: Coaches analyze braking patterns
- Safety: Insurance discounts for smooth riders
- E-bike market: High speeds = more braking scrutiny

---

### 3. Crowdsourced Road Quality Mapping

**Value Proposition:** "Automatically report bad roads, find smooth routes"

**What We Measure:**
- Road roughness score (0-10) per GPS segment
- Vibration RMS in vertical axis
- Major bump/pothole detection (>2g transient)

**Technical Implementation:**
```
Data: Vertical accel (25 Hz) + GPS position (1 Hz)
Algorithm:
  1. For each 1-second GPS window:
     - Calculate RMS: sqrt(mean(accel_z²))
     - Remove DC bias (subtract mean)
  2. Map RMS to score:
     - 0-2 m/s² RMS → Score 0-2 (smooth)
     - 2-4 m/s² RMS → Score 3-5 (moderate)
     - 4-8 m/s² RMS → Score 6-8 (rough)
     - >8 m/s² RMS → Score 9-10 (very rough)
  3. Geotag scores to GPS coordinates
  4. Aggregate from multiple riders (crowdsource)

Accuracy: Relative scores valid (smooth vs rough)
Limitation: Can't classify surface type (need >100 Hz)
```

**UI/Display:**
- Map overlay: Color-code road segments (green=smooth, red=rough)
- Route planning: "Smoothest route" option
- Pothole reporting: Auto-flag >5g bumps, rider confirms
- Leaderboard: "Smoothest ride: Marina (avg 2.1/10)"

**Commercial Applications:**
- Touring cyclists: Avoid rough roads
- City planning: Sell aggregated data to municipalities
- Insurance: Penalize riders who choose risky rough roads

---

## Phase 2: Silver Tier Features (Post-Launch)

### 4. Dynamic G-Force Tracking

**What:** Total G-force magnitude throughout ride
**How:** `sqrt(ax² + ay² + az²)` over time
**Value:** "Intensity metric" beyond just speed

**Example Stats:**
- "Peak G-force: 1.4g at 1:23:45 (braking into hairpin)"
- "Average G-force: 0.3g (smooth cruising)"
- "Time >1g: 12 seconds (high intensity)"

---

### 5. Pedaling Cadence Detection

**What:** RPM from roll oscillation (pedaling sway)
**How:** FFT of roll in 1-5 Hz band during steady riding
**Accuracy:** ±2-3 RPM when it works
**Limitation:** Only on smooth roads, steady pace

**Note:** Your `analysis/cadence_from_roll.ipynb` already proves this works!

---

### 6. Sprint Detection

**What:** Acceleration events >2 m/s² sustained >2s
**How:** Forward accel + GPS speed validation
**Accuracy:** 70-80% (false positives from downhills)

**Example:** "8 sprints detected (avg duration: 12s, max power: 4.2 m/s²)"

---

## What We're NOT Building (Accept Limitations)

### ❌ Real-Time Grade from IMU Pitch
**Why:** Accelerometer can't distinguish tilt from braking during descent
**Drift:** 5-15°/min during sustained dynamics
**Alternative:** Use GPS barometer for grade (±0.5% accuracy)

### ❌ Surface Type Classification (Pavement vs Gravel)
**Why:** Need 400+ Hz sampling to capture 40-160 Hz texture signatures
**Current:** 25 Hz (Nyquist = 12.5 Hz) - undersampled
**Alternative:** Roughness score (0-10) instead of type

### ❌ Absolute Orientation Tracking
**Why:** No magnetometer, gyro drift is unbounded
**Alternative:** Use relative changes (turn delta, peak lean)

---

## GPS Fusion Strategy (Lightweight)

**DON'T:** Try to build complex GPS-IMU Kalman filter (overkill)

**DO:** Use GPS as ground truth anchor, IMU for timing precision

### Simple Fusion Approach

```typescript
// GPS provides (1 Hz):
- Position (lat/lon)
- Velocity (speed, heading)
- Altitude (barometer, not GPS)

// IMU provides (25 Hz):
- Roll (lean angle)
- Acceleration (braking, cornering)
- Roughness (vibration RMS)

// Fusion:
- Use GPS timestamps to anchor position
- Interpolate between GPS waypoints with IMU
- Correct IMU yaw drift: yaw += 0.01 * (gps_heading - imu_yaw)
- Use GPS velocity + baro altitude for grade (ignore IMU pitch for grade)
```

**Complexity:** ~100 lines of code
**Accuracy:** GPS-level position, IMU-level timing

---

## Data Quality Expectations (Post-Sorbothane Damping)

From `DAMPING_RESULTS.md` (Bridge and Hawk ride):

### BNO055 Orientation (Built-in Fusion)
- Roll: -63° to +59° (bounded ✅)
- Pitch: -63° to +63° (bounded ✅, but drifts during sustained descent)
- Yaw: -180° to +180° (proper wraparound ✅)
- Gyro STD: ~400-600 deg/s (noisy but workable)

### What This Means
- ✅ Good enough for short-term peak measurements (<5s)
- ✅ Good enough for event detection (braking, turning)
- ⚠️ Not good for sustained orientation (>30s)
- ❌ Not good for absolute pitch/grade

**Verdict:** 70-80% of ideal quality - sufficient for MVP commercial features

---

## Revenue Model

### Freemium Tiers

**Free:**
- Basic stats (max lean, brake count, roughness avg)
- Route map with sensor data overlay
- Last 30 days of data

**Pro ($5/month or $50/year):**
- Turn-by-turn cornering analysis
- Braking heatmaps and optimization
- Roughness maps and smooth routing
- Unlimited data history
- Export to CSV/GPX
- API access

**Teams ($15/month per rider):**
- Coach dashboard (compare multiple riders)
- Training plan integration
- Performance benchmarking

### Data Monetization

**Municipal Road Quality Reports:**
- Aggregate roughness data by road segment
- Sell to city planning departments
- Privacy-preserving (no individual rider data)
- Revenue: $5-10k per city per year

**Integration Partners:**
- Strava: License roughness data for route quality scores
- Komoot: License for surface quality routing
- Insurance: Partner for "safe rider" discount programs

---

## Competitive Landscape

### What Competitors Have
| Feature | Strava | Garmin | Komoot | Vertex |
|---------|--------|--------|--------|--------|
| Speed/distance | ✅ | ✅ | ✅ | ✅ |
| GPS mapping | ✅ | ✅ | ✅ | ✅ |
| Elevation/grade | ✅ | ✅ | ✅ | ✅ |
| Heart rate | ✅ | ✅ | ❌ | ❌ |
| Power meter | ✅ | ✅ | ❌ | ❌ |
| **Lean angles** | ❌ | ❌ | ❌ | ✅ |
| **G-forces** | ❌ | ❌ | ❌ | ✅ |
| **Braking analysis** | ❌ | ❌ | ❌ | ✅ |
| **Sensor road quality** | ❌ | ❌ | ❌ | ✅ |

**Surface quality:**
- Komoot: Crowdsourced (manual reports)
- Vertex: **Sensor-measured** (automatic, objective)

---

## Target Markets

### Primary: Descending Enthusiasts
- Road cyclists who love technical descents
- Criterium racers (cornering skills)
- Gravel/cyclocross (rough terrain + cornering)
- **Size:** 10-15% of serious cyclists (~500k in US)

### Secondary: Urban Commuters
- Want smooth routes (roughness maps)
- Safety-conscious (braking analysis)
- E-bike users (higher speeds = more braking)
- **Size:** 3-5M regular bike commuters in US

### Tertiary: Municipal/Government
- City planning departments
- Road maintenance prioritization
- Infrastructure budgeting
- **Size:** 19,000 municipalities in US

---

## Technical Specifications

### Sensor Configuration
```
BNO055 IMU (6DoF mode - no magnetometer):
- Sample rate: 25 Hz (optimal for bicycle dynamics)
- Sorbothane damping: Reduces vibration by 10-20 dB
- Gyro range: ±2000 deg/s
- Accel range: ±4g

GPS (from Coros Dura or smartphone):
- Update rate: 1 Hz
- Position accuracy: ±3-5m
- Speed accuracy: ±0.1-0.2 m/s
- Heading accuracy: ±5-10° at speed

Barometer (from Coros):
- Update rate: 1 Hz
- Altitude accuracy: ±1-2m
- Grade calculation: altitude_delta / horizontal_distance
```

### Data Processing Pipeline

**Real-time (on device):**
1. BNO055 sensor fusion → orientation (roll, pitch, yaw)
2. Brake detection from linear accel (gravity-compensated)
3. Stream to VTX binary format (60-70% smaller than CSV)

**Post-processing (cloud):**
1. Low-pass filter accel (5 Hz) to remove vibration
2. Detect events: braking, turns, bumps
3. Calculate metrics: max lean, G-forces, roughness
4. Fuse with GPS: geo-tag events, correct yaw drift
5. Generate insights: turn-by-turn analysis, heatmaps

---

## Known Limitations & Workarounds

### Limitation 1: Pitch Drift During Descents
**Problem:** Pitch drifts +10° to +30° over 1-2 minute descents
**Cause:** Accelerometer can't distinguish tilt from braking
**Workaround:** Use GPS barometer for grade, ignore IMU pitch for grade calculation
**Impact:** Low - grade from GPS is more accurate anyway

### Limitation 2: Roll Baseline Drift
**Problem:** Roll baseline drifts ±5° over 10-30 seconds
**Cause:** Gyro drift, vibration, no mag correction
**Workaround:** Measure relative changes (peak - baseline in turn), not absolute
**Impact:** Low - max lean angle is still accurate

### Limitation 3: Vibration False Positives
**Problem:** 10-20% false brake detections from road bumps
**Cause:** Vibration creates accel spikes similar to braking
**Workaround:** Filter + duration threshold (>0.3s) + GPS speed validation
**Impact:** Medium - acceptable for MVP, improve with ML later

### Limitation 4: No Surface Classification
**Problem:** Can't distinguish pavement from gravel
**Cause:** Need 400+ Hz sampling (we have 25 Hz)
**Workaround:** Roughness score (0-10) instead of surface type
**Impact:** Low - roughness is often more useful than type

---

## Success Metrics (6 Months Post-Launch)

### User Engagement
- [ ] 1,000 active users (riders uploading weekly)
- [ ] 10,000 rides analyzed
- [ ] 50,000+ turns in database

### Feature Usage
- [ ] 70%+ of users view cornering analytics
- [ ] 40%+ use braking analysis
- [ ] 30%+ check road quality maps

### Revenue
- [ ] 15% conversion to Pro ($5/month)
- [ ] 1 municipal data contract ($5-10k)
- [ ] Break even on AWS/Supabase costs

### Data Quality
- [ ] <5% user reports of "bad data"
- [ ] Cornering analytics match user perception (subjective validation)
- [ ] Road quality scores correlate with Strava segment ratings

---

## Development Phases

### Phase 1A: Core Event Detection (2 weeks)
- [ ] Implement braking detection algorithm
- [ ] Implement turn detection (GPS heading + roll)
- [ ] Implement roughness calculation (RMS)
- [ ] API endpoints for event queries
- [ ] Basic UI: event list view

### Phase 1B: Cornering Analytics (2 weeks)
- [ ] Peak lean angle calculation per turn
- [ ] Lateral G-force calculation
- [ ] Turn classification (hairpin, sweeper, chicane)
- [ ] Map visualization with turn overlays
- [ ] Turn-by-turn breakdown UI

### Phase 1C: Braking Analytics (1 week)
- [ ] Braking heatmap on route map
- [ ] Smooth score calculation
- [ ] Harsh braking locations
- [ ] Performance recommendations

### Phase 1D: Road Quality (1 week)
- [ ] Roughness scoring algorithm
- [ ] Road segment aggregation
- [ ] Color-coded map overlay
- [ ] Smoothest route suggestion

### Phase 2: GPS Fusion & Polish (2 weeks)
- [ ] Lightweight GPS-IMU fusion for yaw correction
- [ ] Grade calculation from GPS barometer
- [ ] Sub-second position interpolation
- [ ] Data quality indicators in UI

**Total MVP Timeline:** 8 weeks

---

## Post-MVP: Advanced Features (Backlog)

### Machine Learning Enhancements
- Vibration false positive reduction (trained filter)
- Surface classification (if we add 400 Hz accel)
- Rider style profiling (aggressive vs smooth)

### Hardware V2
- Add high-speed accelerometer (LIS3DH @ 400 Hz)
- Enable pavement vs gravel detection
- Improve vibration rejection

### Advanced Analytics
- Cornering line optimization (racing line vs actual)
- Predictive braking recommendations
- Fatigue detection (degrading smoothness over ride)

---

## References

**Internal Docs:**
- `DAMPING_RESULTS.md` - Sensor validation with sorbothane
- `ROAD_NOISE_FINDINGS.md` - Vibration analysis and mitigation
- `SENSOR_FUSION_VALIDATION_REPORT.md` - Euler angle validation

**Research:**
- Vehicle vibration compensation (adaptive LMS filters)
- Complementary filter design (98% gyro, 2% accel standard)
- Road roughness measurement at GPS rates (1-10 Hz feasible)

---

## Bottom Line

**What makes Vertex unique:**
1. Cornering analytics (lean angles, G-forces) - motorcycles have this, bikes don't
2. Automatic road quality mapping - Komoot relies on crowdsourcing
3. Braking analysis - nobody tracks this for cycling

**What we're NOT competing on:**
- Power meter analysis (Strava/TrainingPeaks own this)
- Heart rate training (Garmin owns this)
- Social features (Strava owns this)

**The wedge:** "Performance analytics for descending" → Own the technical descent niche → Expand from there.

**Commercial viability:** High. Descending enthusiasts will pay $5/month for cornering data nobody else provides. Road quality data has municipal buyer potential. Total addressable market: 500k serious cyclists + 19k cities = viable business.

**Risk:** Data quality issues could damage reputation. Mitigation: Clear disclaimers, focus on relative metrics (not absolute), continuous calibration improvement.

**Recommendation:** Ship the MVP. The sensor data is good enough for the unique features we're building. Perfect is the enemy of shipped.
