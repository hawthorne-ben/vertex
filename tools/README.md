# Vertex Development Tools

Utilities for generating test data and developing the Vertex data pipeline.

## Synthetic IMU Data Generator

`generate_synthetic_imu.py` creates realistic cycling IMU sensor data for testing without physical hardware.

### Quick Start

```bash
# Generate a test ride at 100 Hz (default)
python tools/generate_synthetic_imu.py -o test_ride.csv

# Generate at 10 Hz (lower sample rate for quick testing)
python tools/generate_synthetic_imu.py -o test_ride_10hz.csv --sample-rate 10

# Generate perfect data (no noise)
python tools/generate_synthetic_imu.py -o perfect_ride.csv --no-noise

# Adjust noise level
python tools/generate_synthetic_imu.py -o noisy_ride.csv --noise 0.1
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

### Test Ride Sequence

The default test ride includes:

1. **Stationary** (5s) - Bike at rest
2. **Acceleration** (5s) - 0 → 10 m/s (36 km/h)
3. **Straight** (10s) - Constant velocity
4. **Left Corner** (8s) - 20m radius @ 10 m/s (~0.5G lateral)
5. **Straight** (5s)
6. **Right Corner** (8s) - 25m radius @ 10 m/s (~0.4G lateral)
7. **Straight** (5s)
8. **Braking** (4s) - 10 m/s → 0 (2.5 m/s² decel)
9. **Stationary** (5s) - Stopped

**Total:** ~55 seconds
- At 100 Hz: 5,500 samples (~550 KB)
- At 10 Hz: 550 samples (~55 KB)

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

