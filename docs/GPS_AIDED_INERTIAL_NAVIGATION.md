# GPS-Aided Inertial Navigation Architecture
## Bike x World Model: 6DoF IMU + GPS Velocity Fusion

**Version:** 2.0
**Status:** Architecture Design
**Goal:** Stable, accurate bike orientation in world frame without magnetometer

---

## Executive Summary

### The Problem We're Solving

**Magnetometers are unreliable on bicycles** due to:
- Steel bike frames (soft iron distortion)
- Passing vehicles (dynamic magnetic interference)
- Infrastructure (bridges, tram lines, power lines)
- Impossible to calibrate (can't rotate entire bike in 3D)

**Standard 9DoF fusion** (accel + gyro + mag) produces corrupted orientation when mag is noisy.

### Our Solution: GPS-Aided 6DoF Navigation

**Remove the magnetometer entirely.** Use:
- **Accel + Gyro (6DoF)** for high-rate, stable roll/pitch/yaw
- **GPS velocity heading** to correct slow yaw drift
- **State-based fusion** that adapts to riding conditions

**Result:** Clean orientation data suitable for:
- Lean angle analysis (cornering)
- World-frame acceleration (true north/south/east/west)
- Navigation and mapping
- Advanced dynamics analysis

---

## Architecture Overview

### Three-Layer System

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: World-Frame Kinematics                            │
│  - True north/south acceleration                             │
│  - Geographic position estimation                            │
│  - Route reconstruction                                       │
└─────────────────────────────────────────────────────────────┘
                            ↑
                    Corrected Yaw
                            ↑
┌─────────────────────────────────────────────────────────────┐
│  Layer 2: GPS-Aided Yaw Correction (Complementary Filter)   │
│  - State machine: STOPPED / LOW_SPEED / CRUISING / CORNERING│
│  - Adaptive fusion based on GPS quality + riding state       │
│  - Output: Drift-corrected yaw (bounded error)               │
└─────────────────────────────────────────────────────────────┘
                            ↑
              ┌─────────────┴─────────────┐
              │                           │
    IMU Orientation (50Hz)      GPS Velocity (1-5Hz)
              │                           │
┌─────────────────────────┐  ┌──────────────────────────────┐
│  Layer 1: Sensor Inputs  │  │  GPS Service                  │
│  - BNO055 6DoF IMU       │  │  - Position (lat/lon)         │
│  - Roll/Pitch: Stable    │  │  - Velocity heading           │
│  - Yaw: Drift-prone      │  │  - Speed                       │
│  - 25 Hz sample rate     │  │  - Accuracy metrics           │
└─────────────────────────┘  └──────────────────────────────┘
```

---

## Layer 1: Sensor Inputs (IMPLEMENTED ✓)

### BNO055 in IMU Mode (6DoF)

**Firmware Configuration:**
```cpp
// sensor_manager.cpp
bno.setMode(OPERATION_MODE_IMUPLUS);  // 6DoF: accel + gyro only
```

**What We Get:**
- **Roll/Pitch:** Stable (gravity-corrected by sensor fusion)
- **Yaw:** Accurate short-term, drifts slowly over time
- **Linear Acceleration:** Gravity-compensated
- **Angular Velocity:** Clean gyro data

**Sample Rate:** 25 Hz
**Data Format:** 47 bytes/packet (was 60 with mag)

**Yaw Drift Characteristics:**
- Short-term (<5 min): <5° drift (excellent)
- Medium-term (30 min): 10-20° drift (acceptable)
- Long-term (2+ hours): 50+ ° drift (needs correction)

### GPS Data Source: Bike Head Unit

**Data Source:** Garmin/Wahoo/etc bike computer (NOT phone GPS)

**Format:** .FIT file uploaded separately
- Standard cycling computer format
- Contains: position, speed, heart rate, power, cadence
- GPS track at 1 Hz (smart recording)

**Data Needed:**
- Latitude, Longitude (position)
- Speed (m/s or mph)
- Heading/Course (degrees, 0-360°) - calculated from velocity
- Altitude (for grade estimation)
- Timestamp (UTC)

**Sample Rate:** 1 Hz (typical bike computer)

**Quality Metrics:**
- Bike computers use high-quality GPS chips (better than phones)
- Heading accuracy: ±5° at >10 mph
- Heading accuracy: ±20° at 5 mph
- Heading accuracy: Garbage at <3 mph

**Why Bike Computer GPS > Phone GPS:**
- Better antenna placement (exposed on handlebars)
- Dedicated GPS chip (not power-constrained)
- Already part of cyclist workflow
- No phone battery drain
- More reliable signal

---

## Layer 2: GPS-Aided Yaw Correction

### State Machine

The fusion strategy adapts based on riding conditions:

```
┌──────────────────────────────────────────────────────────┐
│                    RIDING STATE                           │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  STOPPED (speed < 1 mph)                                  │
│  ├─ GPS heading: IGNORE (unreliable)                      │
│  ├─ Gyro: TRUST (zero rotation expected)                  │
│  └─ Yaw correction: NONE                                   │
│                                                           │
│  LOW_SPEED (1-5 mph)                                      │
│  ├─ GPS heading: LOW WEIGHT (noisy)                       │
│  ├─ Gyro: PRIMARY                                         │
│  └─ Yaw correction: α = 0.0-0.05 (minimal)                │
│                                                           │
│  CRUISING (5-15 mph)                                      │
│  ├─ GPS heading: MODERATE WEIGHT (good quality)           │
│  ├─ Gyro: PRIMARY                                         │
│  └─ Yaw correction: α = 0.1 (standard fusion)             │
│                                                           │
│  HIGH_SPEED (>15 mph)                                     │
│  ├─ GPS heading: HIGH WEIGHT (excellent quality)          │
│  ├─ Gyro: PRIMARY                                         │
│  └─ Yaw correction: α = 0.15 (aggressive correction)      │
│                                                           │
│  CORNERING (|gyro_z| > threshold, any speed)              │
│  ├─ GPS heading: VERY LOW WEIGHT (lags reality)           │
│  ├─ Gyro: ABSOLUTE TRUST (real-time turn rate)            │
│  └─ Yaw correction: α *= 0.2 (reduce GPS influence)       │
│                                                           │
└──────────────────────────────────────────────────────────┘
```

### Complementary Filter Algorithm

**Core Equation:**
```
yaw_corrected = (1 - α) * yaw_gyro + α * gps_heading

Where:
  yaw_gyro = integrated gyroscope yaw (drifts over time)
  gps_heading = GPS velocity heading (noisy but drift-free)
  α = fusion weight (0.0-0.15, state-dependent)
```

**Implementation (Python pseudocode):**
```python
class GPSAidedIMU:
    def __init__(self):
        self.yaw_corrected = 0.0
        self.state = RidingState.STOPPED

    def update(self, imu_sample, gps_sample):
        # 1. Integrate gyro for instantaneous yaw change
        dt = imu_sample.dt
        yaw_gyro_delta = imu_sample.gyro_z * dt
        yaw_gyro = self.yaw_corrected + yaw_gyro_delta

        # 2. Determine riding state
        speed = gps_sample.speed
        turning = abs(imu_sample.gyro_z) > TURN_THRESHOLD

        # 3. Calculate fusion weight (α)
        if speed < 1.0:  # STOPPED
            alpha = 0.0
        elif speed < 5.0:  # LOW_SPEED
            alpha = (speed - 1.0) / 4.0 * 0.05  # Linear ramp 0.0-0.05
        elif speed < 15.0:  # CRUISING
            alpha = 0.1
        else:  # HIGH_SPEED
            alpha = 0.15

        # 4. Reduce GPS weight during cornering
        if turning:
            alpha *= 0.2  # GPS lags during turns, trust gyro

        # 5. Reduce GPS weight if poor accuracy
        if gps_sample.accuracy > 10.0:  # >10m accuracy
            alpha *= 0.5

        # 6. Apply complementary filter
        gps_heading = gps_sample.heading
        heading_diff = normalize_angle(gps_heading - yaw_gyro)
        self.yaw_corrected = yaw_gyro + alpha * heading_diff

        # 7. Normalize to [-180, 180]
        self.yaw_corrected = normalize_angle(self.yaw_corrected)

        return self.yaw_corrected
```

**Key Parameters:**
```python
TURN_THRESHOLD = 20.0  # deg/s (detect cornering)
GPS_MIN_SPEED = 1.0    # mph (below this, ignore GPS)
GPS_GOOD_ACCURACY = 5.0  # meters
GPS_POOR_ACCURACY = 10.0  # meters
ALPHA_MAX = 0.15       # Maximum GPS influence
```

---

## Layer 3: World-Frame Kinematics

### Coordinate Transform

With corrected yaw, transform bike-frame acceleration to world frame:

```python
def bike_to_world_frame(accel_bike, yaw_corrected):
    """
    Transform acceleration from bike frame to world frame

    Bike frame:
      X = forward (along bike direction)
      Y = lateral (left/right)
      Z = vertical (up/down)

    World frame:
      X = East
      Y = North
      Z = Up
    """
    yaw_rad = np.radians(yaw_corrected)

    # Rotation around Z axis (yaw)
    accel_east = accel_bike.x * np.cos(yaw_rad) - accel_bike.y * np.sin(yaw_rad)
    accel_north = accel_bike.x * np.sin(yaw_rad) + accel_bike.y * np.cos(yaw_rad)
    accel_up = accel_bike.z  # Vertical unchanged

    return (accel_east, accel_north, accel_up)
```

### Applications

**1. True Acceleration Analysis**
- North/South acceleration (climbing/descending hills)
- East/West acceleration (crosswinds, turns)
- Separate gravity from dynamics

**2. Dead Reckoning (GPS Dropout)**
- Integrate acceleration to estimate position
- Useful in tunnels, urban canyons
- Re-sync when GPS returns

**3. Route Reconstruction**
- Combine GPS position + IMU orientation
- High-rate kinematics (25 Hz) with GPS anchoring (1-5 Hz)
- Smooth, accurate trajectory

**4. Advanced Metrics**
- Cornering G-forces (lateral accel in world frame)
- True climbing power (vertical work against gravity)
- Wind resistance estimation (headwind/tailwind)

---

## Implementation Roadmap

### V1: Post-Processing (Proof of Concept)

**Goal:** Demonstrate GPS-aided yaw correction works

**Workflow:**
1. Record ride with:
   - Vertex IMU logging to VTX file (25 Hz, 6DoF)
   - Bike computer (Garmin/Wahoo) recording GPS track (1 Hz)
2. Upload both files to computer
3. Parse FIT file to extract GPS track
4. Synchronize IMU + GPS by timestamp
5. Run fusion algorithm in Python
6. Generate corrected yaw + world-frame metrics

**Timeline:** 2-3 days after damping hardware arrives

**Data Flow:**
```
Ride:
  Vertex IMU → VTX file (25 Hz IMU data)
  Bike Computer → FIT file (1 Hz GPS + sensors)

Post-Processing:
  VTX → load_vtx.py → IMU DataFrame
  FIT → fitparse → GPS DataFrame
  Sync by timestamp → gps_aided_imu.py → Fused DataFrame
  → Jupyter notebook → Visualizations
```

**Deliverable:**
- FIT file parser integration
- Timestamp synchronization logic
- Jupyter notebook demonstrating fusion
- Corrected yaw plots vs GPS
- World-frame accel analysis

**Dependencies:**
```bash
pip install fitparse  # Parse Garmin/Wahoo FIT files
# Or: pip install garmin-fit-sdk
```

**Files:**
- `analysis/fusion/gps_aided_imu.py` - Fusion algorithm
- `analysis/fusion/fit_parser.py` - Parse bike computer FIT files
- `analysis/fusion/sync.py` - Timestamp synchronization (find offset)
- `analysis/notebooks/02_gps_fusion.ipynb` - Demo notebook

**Example Workflow:**
```python
# Load IMU data
imu_df = load_vtx_file('ride.vtx')

# Load GPS data from bike computer
gps_df = load_fit_file('ride.fit')  # Garmin/Wahoo FIT file

# Synchronize timestamps
imu_df, gps_df = synchronize_timestamps(imu_df, gps_df)

# Run fusion
fused_df = gps_aided_fusion(imu_df, gps_df)

# Visualize
plot_yaw_correction(fused_df)
plot_world_frame_accel(fused_df)
```

---

### V2: Streamlined Workflow (Production)

**Goal:** Seamless integration of bike computer GPS data in web app

**Scope:**
1. Web upload: Accept VTX + FIT file pairs
2. Auto-detect matching rides by timestamp proximity
3. Run fusion on server (Python microservice or edge function)
4. Store corrected yaw + world-frame metrics in database
5. Display fused results in web app charts

**Timeline:** After V1 proven

**Architecture Options:**

**Option A: Server-Side Fusion**
```
Browser Upload (VTX + FIT)
  ↓
Supabase Edge Function (Deno + Python)
  ↓
Run gps_aided_imu.py
  ↓
Store results in PostgreSQL
  ↓
Web app displays fused data
```

**Option B: Client-Side Fusion (TypeScript port)**
```
Browser Upload (VTX + FIT)
  ↓
Parse + fuse entirely in browser
  ↓
Store raw + fused data
  ↓
No server processing needed
```

**Option C: Keep It Simple (Recommended for V2)**
- Post-process in Python/Jupyter locally
- Export fused data as CSV or enhanced VTX
- Upload fused file to web app
- Avoid complexity until algorithm proven

**Recommendation:** Start with Option C, evolve to A/B if needed

**Files (if implementing A or B):**
- `web/src/lib/fusion/fit-parser.ts` - Browser-side FIT parsing
- `web/src/lib/fusion/gps-aided-imu.ts` - Fusion (port from Python)
- `web/src/app/upload/page.tsx` - Accept VTX + FIT pairs
- Update API to handle paired uploads

---

### V3: Advanced Features (Future)

**Scope:**
- Kalman filter (better than complementary)
- Adaptive noise estimation
- Multi-sensor outlier rejection
- Real-time dead reckoning
- Route prediction
- Auto-upload from bike computer (Garmin API, Strava API)
- **Phone GPS integration** (optional, for riders without bike computer)

**Phone GPS Future Use Cases:**
- Riders without dedicated bike computer
- Real-time yaw correction on device (for live features)
- Backup GPS when bike computer battery dies
- Indoor trainer mode (no GPS available, pure IMU with expected drift)
- Ultra-budget setup (phone only, no bike computer)

**Implementation If Needed:**
- `android/src/services/GPSService.ts` - Phone GPS tracking
- React Native Geolocation API
- Store GPS in VTX metadata or separate GPX file
- Simpler than FIT parsing (direct access)

**Trade-offs:**
- ✅ No external device needed
- ✅ Simpler workflow
- ❌ Worse GPS quality than bike computer
- ❌ Phone battery drain
- ❌ Less convenient mounting on handlebars

**Recommendation:** Stick with bike computer GPS for V1/V2. Phone GPS only if users request it.

**Timeline:** After V2 deployed, if needed

---

## Technical Specifications

### Data Streams

**IMU Stream (VTX file, 25 Hz):**
```
{
  timestamp: ms,
  roll: degrees [-180, 180],      // Stable (gravity-corrected)
  pitch: degrees [-180, 180],     // Stable (gravity-corrected)
  yaw: degrees [-180, 180],       // Drift-prone (needs GPS correction)
  accel: [x, y, z] m/s²,          // Bike frame, gravity-compensated
  gyro: [x, y, z] rad/s,          // Angular rates
}
```

**GPS Stream (FIT file from bike computer, 1 Hz):**
```
{
  timestamp: UTC ms,              // Needs sync with IMU timestamps
  position_lat: degrees,
  position_long: degrees,
  altitude: meters,
  speed: m/s,
  heading: degrees [0, 360],      // Calculated from velocity vector
  enhanced_speed: m/s,            // High-res speed if available
  enhanced_altitude: meters,
  grade: percent,                 // Road grade (useful!)
  heart_rate: bpm,                // Bonus data
  power: watts,                   // Bonus data (if power meter)
  cadence: rpm,                   // Bonus data
}
```

### Synchronization

**Challenge:** Two separate devices with different clocks

**IMU Timestamps:**
- Recorded by Android phone
- Device local time
- High precision (ms)

**GPS Timestamps:**
- Recorded by bike computer
- UTC time from satellites
- 1 second resolution

**Synchronization Strategy:**

**Option A: Manual Time Offset (Simple)**
```python
# Find offset by matching patterns
# E.g., when did ride start/stop in both files?
time_offset = gps_start_time - imu_start_time
imu_df['timestamp_synced'] = imu_df['timestamp'] + time_offset
```

**Option B: Pattern Matching (Robust)**
```python
# Match speed patterns from IMU accel to GPS speed
# Use cross-correlation to find optimal offset
offset = find_best_correlation(imu_accel_forward, gps_speed)
```

**Option C: GPS Time Sync on Android (Future)**
- Android app reads GPS time from bike computer (BLE)
- Synchronizes IMU timestamps to GPS time
- No post-processing sync needed

**For V1: Use Option A (manual offset) - simplest**

**After synchronization:**
- Interpolate GPS to IMU rate (linear interpolation for heading/speed)
- Handle GPS dropout (NaN values during tunnels)

**Interpolation example:**
```python
def interpolate_gps(gps_samples, imu_timestamps):
    """Interpolate GPS heading/speed to IMU rate"""
    gps_times = [s.timestamp for s in gps_samples]
    gps_headings = [s.heading for s in gps_samples]
    gps_speeds = [s.speed for s in gps_samples]

    # Linear interpolation
    interp_headings = np.interp(imu_timestamps, gps_times, gps_headings)
    interp_speeds = np.interp(imu_timestamps, gps_times, gps_speeds)

    return interp_headings, interp_speeds
```

---

## Algorithm Details

### State Determination

```python
class RidingState(Enum):
    STOPPED = 0      # speed < 1 mph
    LOW_SPEED = 1    # 1-5 mph
    CRUISING = 2     # 5-15 mph
    HIGH_SPEED = 3   # >15 mph
    CORNERING = 4    # |gyro_z| > threshold (override)

def determine_state(speed_mph, gyro_z_deg_s):
    # Cornering overrides speed-based state
    if abs(gyro_z_deg_s) > 20.0:  # >20 deg/s = turning
        return RidingState.CORNERING

    # Speed-based states
    if speed_mph < 1.0:
        return RidingState.STOPPED
    elif speed_mph < 5.0:
        return RidingState.LOW_SPEED
    elif speed_mph < 15.0:
        return RidingState.CRUISING
    else:
        return RidingState.HIGH_SPEED
```

### Fusion Weight Calculation

```python
def calculate_alpha(state, gps_accuracy, speed_mph):
    """
    Calculate GPS fusion weight (α)

    Returns: 0.0-0.15 (0 = pure gyro, 0.15 = max GPS influence)
    """
    # Base alpha from state
    if state == RidingState.STOPPED:
        alpha = 0.0
    elif state == RidingState.LOW_SPEED:
        # Linear ramp from 0.0 to 0.05 as speed increases
        alpha = (speed_mph - 1.0) / 4.0 * 0.05
    elif state == RidingState.CRUISING:
        alpha = 0.1
    elif state == RidingState.HIGH_SPEED:
        alpha = 0.15
    elif state == RidingState.CORNERING:
        # During turns, GPS lags - trust gyro
        alpha = 0.02  # Minimal GPS influence

    # Reduce weight for poor GPS accuracy
    if gps_accuracy > 10.0:  # >10m = poor
        alpha *= 0.3
    elif gps_accuracy > 5.0:  # >5m = moderate
        alpha *= 0.7

    return alpha
```

### Complementary Filter

```python
def fuse_yaw(yaw_gyro, gps_heading, alpha):
    """
    Complementary filter for yaw fusion

    Args:
        yaw_gyro: Integrated gyro yaw (drifts)
        gps_heading: GPS velocity heading (noisy but drift-free)
        alpha: Fusion weight [0, 1]

    Returns:
        Corrected yaw estimate
    """
    # Calculate heading error (handle wrap-around)
    heading_diff = normalize_angle(gps_heading - yaw_gyro)

    # Apply correction proportional to alpha
    yaw_corrected = yaw_gyro + alpha * heading_diff

    # Normalize to [-180, 180]
    yaw_corrected = normalize_angle(yaw_corrected)

    return yaw_corrected

def normalize_angle(angle):
    """Normalize angle to [-180, 180] range"""
    while angle > 180:
        angle -= 360
    while angle < -180:
        angle += 360
    return angle
```

---

## Expected Performance

### Yaw Accuracy

| Condition | GPS Heading Error | Gyro Drift Rate | Fused Yaw Error |
|-----------|-------------------|-----------------|-----------------|
| Stopped | ±180° (random) | 0°/min | <1° (trust gyro) |
| Low speed (3 mph) | ±20° | 0.3°/min | <5° |
| Cruising (10 mph) | ±5° | 0.5°/min | <2° |
| High speed (20 mph) | ±3° | 0.5°/min | <1° |
| Cornering | ±10° (lag) | 0.5°/min | <3° (trust gyro) |

**Overall:** <5° yaw error for typical 30-60 minute rides ✓

### Comparison to Magnetometer

| Metric | 9DoF (Accel+Gyro+Mag) | 6DoF + GPS |
|--------|----------------------|------------|
| Roll accuracy | ±2° | ±2° (same) |
| Pitch accuracy | ±2° | ±2° (same) |
| Yaw accuracy (clean environment) | ±5° | ±3° |
| Yaw accuracy (interference) | ±30° (corrupted!) | ±3° (robust) |
| Calibration required | YES (difficult) | NO |
| Immune to metal interference | NO | YES |
| Works indoors/tunnels | YES | NO (GPS dropout) |

**Verdict:** 6DoF + GPS is superior for outdoor cycling

---

## Implementation: V1 Post-Processing

### File Structure

```
analysis/
├── fusion/
│   ├── __init__.py
│   ├── gps_aided_imu.py          # Core fusion algorithm
│   ├── state_machine.py          # Riding state determination
│   └── coordinate_transforms.py  # Bike ↔ World frame
├── notebooks/
│   └── 02_gps_fusion_demo.ipynb  # Proof of concept demo
└── data/
    └── sample-recordings/
        ├── ride_with_gps.vtx     # IMU data (25 Hz, 6DoF)
        └── ride_with_gps.gpx     # GPS track (1-5 Hz)
```

### Core Functions

**gps_aided_imu.py:**
```python
class GPSAidedIMU:
    """
    GPS-aided yaw correction for 6DoF IMU

    Fuses gyro-integrated yaw with GPS velocity heading
    using state-dependent complementary filter
    """

    def __init__(self, config=None):
        self.config = config or DefaultConfig()
        self.yaw = 0.0
        self.state = RidingState.STOPPED

    def process_ride(self, imu_df, gps_df):
        """
        Process entire ride (batch mode)

        Args:
            imu_df: DataFrame with IMU data at 25 Hz
            gps_df: DataFrame with GPS data at 1-5 Hz

        Returns:
            DataFrame with corrected yaw added
        """
        # Interpolate GPS to IMU rate
        gps_interp = interpolate_gps(gps_df, imu_df['timestamp'])

        # Process sample by sample
        yaw_corrected = []
        states = []
        alphas = []

        for i in range(len(imu_df)):
            imu = imu_df.iloc[i]
            gps = gps_interp.iloc[i]

            # Determine state
            state = determine_state(gps.speed, imu.gyro_z)

            # Calculate alpha
            alpha = calculate_alpha(state, gps.accuracy, gps.speed)

            # Fuse yaw
            yaw = self.update_yaw(imu, gps, alpha)

            yaw_corrected.append(yaw)
            states.append(state)
            alphas.append(alpha)

        # Add to dataframe
        imu_df['yaw_corrected'] = yaw_corrected
        imu_df['riding_state'] = states
        imu_df['gps_weight'] = alphas

        return imu_df
```

### Validation Metrics

```python
def validate_fusion(imu_df):
    """Calculate fusion performance metrics"""

    # Yaw drift rate (without GPS)
    yaw_raw_drift = calculate_drift_rate(imu_df['yaw'])

    # Yaw error (with GPS)
    yaw_corrected_error = calculate_heading_error(
        imu_df['yaw_corrected'],
        imu_df['gps_heading']
    )

    # State distribution
    state_distribution = imu_df['riding_state'].value_counts()

    return {
        'raw_drift_deg_per_hour': yaw_raw_drift * 60,
        'corrected_error_rms': yaw_corrected_error,
        'state_distribution': state_distribution,
    }
```

---

## Data Collection Requirements

### For V1 Testing

**Need:**
1. ✅ IMU recording (VTX file, 6DoF mode) - READY after firmware flash
2. ✅ GPS tracking (FIT file from bike computer) - Already have bike computer!
3. ⚠️ Timestamp synchronization - Manual offset (post-processing)
4. ❌ FIT file parser - Need Python library (fitparse or garmin-fit-sdk)

**Test Ride Requirements:**
- Duration: 15-30 minutes
- Equipment:
  - Vertex IMU running and recording to VTX
  - Bike computer running and recording ride
- Mix of conditions:
  - Straight sections at various speeds
  - Turns (left and right)
  - Stops (traffic lights)
  - Varied terrain (flat, hills)
- Open sky (good GPS signal)

**After Ride:**
1. Export VTX file from Android app
2. Export FIT file from bike computer (Garmin Connect, Wahoo app, etc.)
3. Both files to computer for post-processing

**Ideal Test Route:**
- Loop course (start = end position)
- Allows validating yaw: should return to 0° offset
- GPS heading should match final yaw (if no drift)

---

## Success Criteria

### V1 Proof of Concept

**Must Demonstrate:**
- ✅ Yaw drift <10° over 30 minute ride (with GPS correction)
- ✅ Yaw drift >50° over 30 minute ride (without GPS correction)
- ✅ Roll/pitch unaffected (still stable)
- ✅ State machine switches correctly
- ✅ Cornering detection reduces GPS weight

**Deliverable:**
- Working Python implementation
- Jupyter notebook with visualizations
- Before/after yaw comparison plots
- Performance metrics

---

### V2 Production

**Must Deliver:**
- ✅ Real-time or near-real-time fusion
- ✅ GPS integrated into recording workflow
- ✅ Corrected yaw stored in VTX or companion file
- ✅ <5° yaw error for typical rides
- ✅ Graceful GPS dropout handling

---

## Alternative: Kalman Filter (Advanced)

For V2+, consider upgrading to Extended Kalman Filter:

**State Vector:**
```
x = [yaw, yaw_rate, yaw_bias]
```

**Prediction (IMU, 25 Hz):**
```
yaw_k = yaw_{k-1} + (gyro_z - yaw_bias) * dt
yaw_bias_k = yaw_bias_{k-1}  // Assume constant
```

**Update (GPS, 1-5 Hz):**
```
Measurement: z = gps_heading
Innovation: y = z - yaw_k
Kalman gain: K = f(state_covariance, measurement_noise)
Correction: x_k = x_k + K * y
```

**Benefits over Complementary:**
- ✅ Estimates gyro bias (improves long-term accuracy)
- ✅ Probabilistic (optimal fusion)
- ✅ Handles variable GPS rates elegantly

**Complexity:**
- Requires tuning process noise / measurement noise
- More code (100+ lines vs 20 for complementary)
- Marginal improvement for cycling (complementary is 90% as good)

**Recommendation:** Start with complementary, upgrade to Kalman if needed

---

## Why This Is Portfolio-Worthy

### Demonstrates:

1. **Sensor Fusion Expertise**
   - Multi-rate sensor integration (25 Hz IMU + 1-5 Hz GPS)
   - State-dependent fusion strategies
   - Robust to sensor dropout

2. **Practical Engineering**
   - Identified magnetometer limitations
   - Chose appropriate solution for domain (cycling)
   - Prioritized robustness over theoretical "best"

3. **Real-World Problem Solving**
   - Magnetic interference is a known robotics problem
   - GPS-aided INS is industry-standard (aviation, automotive)
   - Adapted to cycling-specific constraints

4. **Full-Stack Implementation**
   - Firmware (6DoF mode selection)
   - Mobile app (GPS integration)
   - Post-processing (fusion algorithm)
   - Validation (metrics and testing)

5. **Clear Technical Writing**
   - This document!
   - Jupyter notebooks with visualizations
   - Code comments explaining decisions

---

## References & Prior Art

### Industry Examples

**Aviation:**
- GPS/INS fusion for navigation
- Mag-free systems in high-interference environments
- WAAS/EGNOS differential GPS

**Automotive:**
- Tesla: GPS + IMU for Autopilot
- No magnetometer in vehicle navigation
- Wheel odometry + GPS fusion

**Robotics:**
- ROS navigation stack: sensor_fusion package
- Complementary and Kalman filters standard
- GPS-denied indoor vs GPS-aided outdoor

### Academic References

**Complementary Filters:**
- Mahony et al., "Complementary filter design on the special orthogonal group SO(3)"
- Simple, robust, computationally efficient

**GPS-Aided INS:**
- Farrell & Barth, "The Global Positioning System and Inertial Navigation"
- Standard textbook on GPS/IMU fusion

**Adaptive Filtering:**
- State-dependent noise covariance
- Velocity-based quality metrics

---

## Summary

### Current State (6DoF)
- ✅ Roll/pitch: Stable, gravity-corrected
- ⚠️ Yaw: Accurate short-term, drifts long-term
- ✅ No magnetic interference
- ✅ 20% smaller data files

### After GPS Fusion (V1)
- ✅ Roll/pitch: Stable (unchanged)
- ✅ Yaw: Corrected, <5° error
- ✅ World-frame kinematics available
- ✅ Robust to all conditions

### Future Capabilities (V2+)
- ✅ Real-time corrected orientation
- ✅ Dead reckoning during GPS dropout
- ✅ Route reconstruction
- ✅ Advanced dynamics analysis

**This creates a production-grade inertial navigation system suitable for cycling!** 🚴‍♂️🧭
