# Vertex Development Tools

Utilities for generating test data and developing the Vertex data pipeline.

## Synthetic IMU Data Generator

`generate_synthetic_imu.py` creates realistic cycling IMU sensor data for testing without physical hardware.

### Quick Start

```bash
# Generate a test ride at 100 Hz (default)
python3 tools/generate_synthetic_imu.py -o test_ride.csv

# Generate at 10 Hz (lower sample rate for quick testing)
python3 tools/generate_synthetic_imu.py -o test_ride_10hz.csv --sample-rate 10

# Generate perfect data (no noise)
python3 tools/generate_synthetic_imu.py -o perfect_ride.csv --no-noise

# Adjust noise level
python3 tools/generate_synthetic_imu.py -o noisy_ride.csv --noise 0.1
```

### Advanced Usage

#### Preset Ride Types

```bash
# Short ride (~14 seconds)
python3 tools/generate_synthetic_imu.py --preset short -o short_ride.csv

# Medium ride (~60 seconds) - default
python3 tools/generate_synthetic_imu.py --preset medium -o medium_ride.csv

# Long ride (~3 minutes)
python3 tools/generate_synthetic_imu.py --preset long -o long_ride.csv

# Aggressive riding (high speeds, tight corners)
python3 tools/generate_synthetic_imu.py --preset aggressive -o aggressive_ride.csv

# Endurance riding (steady pace, gentle corners)
python3 tools/generate_synthetic_imu.py --preset endurance -o endurance_ride.csv
```

#### Custom Duration

```bash
# Generate a 2-minute ride using medium preset
python3 tools/generate_synthetic_imu.py --preset medium --duration 120 -o custom_ride.csv

# Generate specific scenarios only
python3 tools/generate_synthetic_imu.py --scenarios acceleration cornering braking --duration 30 -o custom_ride.csv
```

#### Scenario-Specific Parameters

```bash
# High-speed cornering
python3 tools/generate_synthetic_imu.py --scenarios cornering --corner-speed 15 --corner-radius 10 --corner-direction left -o tight_corner.csv

# Hard acceleration
python3 tools/generate_synthetic_imu.py --scenarios acceleration --target-speed 20 --accel-rate 4.0 -o hard_accel.csv

# Emergency braking
python3 tools/generate_synthetic_imu.py --scenarios braking --initial-speed 15 --decel-rate 5.0 -o emergency_brake.csv
```

### Output Format

CSV file matching BNO055 IMU sensor format:

```csv
timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z
0.0,0.000234,-0.001234,-9.805432,0.000123,-0.000456,0.000089,20.123,0.234,-39.876
10.0,0.001234,-0.002345,-9.812345,0.000234,-0.000567,0.000123,20.234,0.345,-39.987
...
```

**Units:**
- `timestamp_ms`: milliseconds
- `accel_{x,y,z}`: m/s² (body frame: X=forward, Y=left, Z=up)
- `gyro_{x,y,z}`: rad/s (angular velocity: X=pitch, Y=roll, Z=yaw)
- `mag_{x,y,z}`: µT (magnetometer, for heading reference)

### Preset Ride Configurations

#### Short (~14 seconds)
- Quick acceleration, single corner, brake to stop
- Good for testing basic pipeline functionality

#### Medium (~60 seconds) - Default
- Full ride sequence: start → accelerate → cruise → corners → brake → stop
- Balanced mix of all scenarios
- Good for comprehensive testing

#### Long (~3 minutes)
- Extended cruise sections
- Multiple corners with varying radii
- Simulates longer training rides

#### Aggressive (~30 seconds)
- High speeds (15 m/s = 54 km/h)
- Tight corners (10-12m radius)
- Hard acceleration and braking
- Good for testing extreme scenarios

#### Endurance (~3.5 minutes)
- Steady, moderate pace (8 m/s = 29 km/h)
- Gentle acceleration and braking
- Wide corners (35-40m radius)
- Long cruise sections
- Simulates endurance/audax riding

### Command Line Options

#### Basic Options
- `--output, -o`: Output filename (default: `synthetic_ride.csv`)
- `--sample-rate, -r`: Sample rate in Hz (default: 100)
- `--duration, -d`: Total duration in seconds (scales preset scenarios)
- `--noise, -n`: Noise level in m/s² (default: 0.05)
- `--no-noise`: Disable noise (perfect data)

#### Scenario Selection
- `--scenarios, -s`: Choose specific scenarios: `stationary`, `acceleration`, `cornering`, `braking`
- `--preset`: Use predefined ride type: `short`, `medium`, `long`, `aggressive`, `endurance`

#### Acceleration Parameters
- `--target-speed`: Target speed for acceleration (m/s, default: 10)
- `--accel-rate`: Acceleration rate (m/s², default: 2.0)

#### Cornering Parameters
- `--corner-speed`: Speed during cornering (m/s, default: 10)
- `--corner-radius`: Corner radius (m, default: 20)
- `--corner-direction`: Corner direction: `left` or `right` (default: left)

#### Braking Parameters
- `--initial-speed`: Initial speed for braking (m/s, default: 10)
- `--decel-rate`: Deceleration rate (m/s², default: 2.5)

### Extending the Generator

The script is designed to be easily extended with new scenarios:

```python
class CustomScenario(MotionScenario):
    def _compute_sample(self, t: float) -> IMUSample:
        # Your custom motion physics here
        return IMUSample(...)
```

### Physics Notes

**Cornering:**
- Centripetal acceleration: `a = v²/r`
- Lean angle: `θ = atan(a/g)`
- At 10 m/s (36 km/h) in a 20m radius corner:
  - Lateral G: 0.51G
  - Lean angle: ~27°

**Sensor Noise:**
- Typical BNO055 accel noise: 0.05-0.1 m/s² RMS
- Typical gyro noise: 0.01-0.02 rad/s RMS

### Known Simplifications

This is **synthetic data for pipeline development**, not a perfect physics simulation:

1. **No GPS data** (add this if needed for map overlays)
2. **Simplified gravity rotation** (real bikes have complex suspension dynamics)
3. **Idealized corners** (constant radius/speed - real corners vary)
4. **Simple vibration model** (real road surfaces are fractal noise)
5. **No sensor drift** (real IMUs accumulate integration errors)

These simplifications are **fine** for developing:
- File parsing
- Data storage
- Filtering algorithms
- Visualization
- Event detection logic

You'll tune thresholds and parameters with real data later.

## Future Tools

- `parse_fit_file.py` - Extract GPS/power from real cycling computer files
- `compare_rides.py` - Diff two rides for A/B equipment testing
- `validate_imu_csv.py` - Check if uploaded CSV meets format requirements

