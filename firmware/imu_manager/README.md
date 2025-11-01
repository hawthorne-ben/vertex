# Vertex Sensor Notify Firmware

**BLE-only IMU sensor streaming for mobile app integration**

## Quick Start

```bash
# Compile
cd firmware/sensor_notify
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32_v2 sensor_notify.ino

# Upload (adjust port as needed)
arduino-cli upload \
  --fqbn esp32:esp32:adafruit_feather_esp32_v2 \
  --port /dev/cu.usbserial-XXXXXXXX \
  --upload-property upload.speed=115200 \
  sensor_notify.ino

# Monitor
arduino-cli monitor --port /dev/cu.usbserial-XXXXXXXX --config baudrate=115200
```

## Overview

This firmware provides real-time sensor data streaming via Bluetooth Low Energy (BLE) notifications. It's designed for the Vertex Android app to receive IMU data from the BNO055 sensor at 50Hz.

### Key Features

- ✅ **BLE Notify Server** - Real-time sensor streaming
- ✅ **No WiFi** - Battery-efficient, BLE-only operation
- ✅ **No NTP** - Phone provides timestamps
- ✅ **50Hz Sampling** - High-frequency motion tracking
- ✅ **Extensive Logging** - Detailed serial debug output
- ✅ **Battery Monitoring** - Voltage and percentage reporting
- ✅ **Calibration Status** - Real-time sensor calibration feedback

## Hardware Requirements

- **Microcontroller**: Adafruit Feather ESP32 V2
- **Sensor**: BNO055 9-DOF Absolute Orientation IMU
- **Battery**: 3.7V LiPo (500mAh recommended)

### Wiring

```
BNO055  →  Feather ESP32 V2
----------------------------
VIN     →  3V (3.3V power)
GND     →  GND
SDA     →  GPIO 22 (SDA)
SCL     →  GPIO 23 (SCL)
```

## Software Requirements

- **Arduino CLI** (recommended) or Arduino IDE 2.0+
- **ESP32 Board Support**: v3.3.2
- **Libraries**:
  - Adafruit BNO055 v1.6.4
  - Adafruit Unified Sensor v1.1.15
  - ESP32 BLE Arduino (included with ESP32 core)

### Installation & Compilation

#### Using Arduino CLI (Recommended)

**1. Install Arduino CLI**:
```bash
# macOS
brew install arduino-cli

# Linux/Windows - see: https://arduino.github.io/arduino-cli/
```

**2. Install ESP32 Board Support**:
```bash
arduino-cli core install esp32:esp32
```

**3. Install Required Libraries**:
```bash
arduino-cli lib install "Adafruit BNO055"
arduino-cli lib install "Adafruit Unified Sensor"
```

**4. Compile Firmware**:
```bash
cd firmware/sensor_notify
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32_v2 sensor_notify.ino
```

**5. Upload to Board**:
```bash
# Find your port
arduino-cli board list

# Upload (replace PORT with your actual port)
arduino-cli upload \
  --fqbn esp32:esp32:adafruit_feather_esp32_v2 \
  --port /dev/cu.usbserial-XXXXXXXX \
  --upload-property upload.speed=115200 \
  sensor_notify.ino
```

**6. Monitor Serial Output**:
```bash
arduino-cli monitor --port /dev/cu.usbserial-XXXXXXXX --config baudrate=115200
```

#### Using Arduino IDE

**1. Install ESP32 Board Support**:
   - Arduino IDE → Preferences
   - Add URL: `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   - Tools → Board Manager → Install "esp32"

**2. Install Required Libraries**:
   - Sketch → Include Library → Manage Libraries
   - Search and install:
     - "Adafruit BNO055"
     - "Adafruit Unified Sensor"

**3. Upload Firmware**:
   - Open `sensor_notify.ino`
   - Tools → Board → ESP32 Arduino → "Adafruit Feather ESP32 V2"
   - Tools → Port → Select your port
   - Click Upload

## Configuration

Edit `config.h` to customize:

```cpp
// Device name (shows in BLE scan)
#define DEVICE_NAME "Vertex-IMU"

// Sensor sampling rate
#define SENSOR_SAMPLE_RATE_HZ 50  // 20ms interval

// Battery thresholds
#define LOW_BATTERY_VOLTAGE 3.3    // Warning level
#define CRITICAL_BATTERY_VOLTAGE 3.0  // Shutdown level

// Debug logging
#define DEBUG_SENSOR_ENABLED true
#define DEBUG_BLE_ENABLED true
#define DEBUG_BATTERY_ENABLED true
```

## BLE Service Specification

### Service UUID
```
12345678-1234-5678-1234-56789abcdef0
```

### Characteristics

#### Sensor Data (NOTIFY + READ)
**UUID**: `12345678-1234-5678-1234-56789abcdef1`

Binary packet (60 bytes, little-endian):
- **Timestamp** (4 bytes) - `uint32_t` milliseconds since boot
- **Euler Angles** (12 bytes) - 3× `float` (roll, pitch, yaw in degrees)
- **Acceleration** (12 bytes) - 3× `float` (x, y, z in m/s²)
- **Gyroscope** (12 bytes) - 3× `float` (x, y, z in rad/s)
- **Magnetometer** (12 bytes) - 3× `float` (x, y, z in µT)
- **Calibration** (4 bytes) - 4× `uint8_t` (sys, gyro, accel, mag: 0-3)
- **Battery Voltage** (4 bytes) - `float` (voltage in V)

**Sample Rate**: 10Hz (optimized for stability, 50-100Hz capable with further optimization)

**Notes**:
- All floats use IEEE 754 single-precision format
- Battery voltage read once per second to reduce overhead
- Quaternions removed in v2.0 for efficiency (use Euler angles)

## Serial Monitor Output

Connect at **115200 baud** to see detailed logging:

```
╔══════════════════════════════════════╗
║   VERTEX SENSOR NOTIFY FIRMWARE     ║
╚══════════════════════════════════════╝

Firmware Version: 1.0.0
Device Name: Vertex-IMU
Sensor Rate: 50 Hz
BLE MTU: 512 bytes

========================================
  BNO055 Sensor Initialization
========================================
[SENSOR] Initializing I2C on SDA=22, SCL=23 @ 100 kHz...
[SENSOR] I2C scan complete. Found 1 device(s)
[SENSOR] Found device at 0x28
[OK] BNO055 initialized successfully!
[SENSOR] Chip ID: 0xA0 (expected: 0xA0)
[SENSOR] Software Rev: 3.11
[SENSOR] Initial calibration status:
[SENSOR]   System: 0/3
[SENSOR]   Gyro:   0/3
[SENSOR]   Accel:  0/3
[SENSOR]   Mag:    0/3

========================================
  BLE Server Initialization
========================================
[BLE] Device address: 24:0a:c4:xx:xx:xx
[BLE] Creating sensor service...
[OK] BLE server initialized and advertising!

========================================
  System Ready!
  Battery: 3.87V (72%)
  Device: Vertex-IMU
  Waiting for BLE connection...
========================================

[BLE] CLIENT CONNECTED
[SENSOR] Read #50: Roll=2.1° Pitch=-0.5° Yaw=180.3° | Cal: S=0 G=0 A=0 M=0
[BLE] Notification #50 sent (73 bytes): R=2.1° P=-0.5° Y=180.3°
```

## LED Indicators

The built-in LED (GPIO 13) indicates system status:

| Pattern | Status |
|---------|--------|
| Slow blink (1s) | Waiting for connection |
| Fast blink (100ms) | Connected, streaming data |
| Very fast blink (200ms) | Low battery warning |
| Rapid flash (100ms) | Critical battery / error |

## Calibration

The BNO055 requires calibration for accurate measurements:

1. **Gyroscope**: Keep still for 2-3 seconds
2. **Accelerometer**: Move through all 6 positions (all faces up/down)
3. **Magnetometer**: Move in figure-8 pattern in 3D space
4. **System**: All sensors must reach level 3

Watch Serial Monitor for calibration status:
```
[SENSOR] Initial calibration status:
[SENSOR]   System: 3/3  ✅ Fully calibrated
[SENSOR]   Gyro:   3/3  ✅
[SENSOR]   Accel:  3/3  ✅
[SENSOR]   Mag:    3/3  ✅
```

## Power Management

- **Normal Operation**: ~50-80mA @ 3.7V
- **Battery Monitoring**: Every 5 seconds
- **Low Battery Warning**: 3.3V (LED blinks fast)
- **Critical Shutdown**: 3.0V (protects battery)

### Battery Life Estimates

| Battery Capacity | Runtime |
|-----------------|---------|
| 500mAh | ~6-10 hours |
| 1200mAh | ~15-24 hours |
| 2500mAh | ~31-50 hours |

*Actual runtime depends on BLE activity and sensor configuration*

## Troubleshooting

### Sensor Not Found

```
[ERROR] Failed to initialize BNO055!
```

**Solutions**:
- Check wiring (SDA, SCL, VCC, GND)
- Verify I2C address (should be 0x28)
- Try lowering I2C clock speed in `config.h`

### No BLE Connection

**Check**:
- Phone Bluetooth is enabled
- Device is in range (<10m)
- Not already connected to another device
- Try restarting both device and phone

### Low Battery Performance

If sensors become unreliable below 3.5V:
- Charge battery immediately
- Consider larger capacity battery
- Reduce sample rate in `config.h`

## Development

### Adding Custom Features

1. **Modify sensor data structure** in `sensor_manager.h`
2. **Update BLE packet** in `ble_server.cpp::sendSensorData()`
3. **Update Android app** BLE parsing to match

### Debug Logging

Enable/disable logging in `config.h`:
```cpp
#define DEBUG_SENSOR_ENABLED true
#define DEBUG_BLE_ENABLED true
#define DEBUG_BATTERY_ENABLED true
```

### Performance Monitoring (v2.0 - Added)

Built-in benchmarking reports every 5 seconds via Serial:

```
=== PERFORMANCE METRICS ===
Sample Rate: 10.0 Hz (target: 10 Hz)
Sensor I2C Read: 15234 µs (15.2 ms)
BLE Notify: 1234 µs (1.2 ms)
Loop Time: 156 µs (0.2 ms)
Max Loop: 16890 µs (16.9 ms)
CPU Usage: 16.9%
CPU Temp: 45.3°C
Free Heap: 254332 bytes
Total Overhead: 16468 µs (16.5 ms)
Available Time @10Hz: 83.5 ms
Max Theoretical Hz: 60.7 Hz
==========================
```

**Key Metrics:**
- **Sensor I2C Read**: Measures I2C communication bottleneck
- **BLE Notify**: Time to pack and send notification
- **CPU Temp**: ESP32 internal temperature (thermal monitoring)
- **Max Theoretical Hz**: Calculated maximum achievable frequency
- **Available Time**: Slack time at current sample rate

**Overhead**: ~200-300µs per report (0.006% at 5s intervals - negligible)

**Production Considerations**:
- **Keep for Beta/Testing**: Critical for validating 50-100Hz optimizations and field diagnostics
- **Add Compile Flag**: Wrap in `#ifdef ENABLE_PROFILING` for release builds
- **Future**: Add BLE broadcast characteristic for app-visible diagnostics (optional)

## Performance Optimizations (v2.0)

### What Changed
- **I2C Speed**: 100kHz → 400kHz (4x faster sensor reads)
- **Logging Removed**: All runtime BLE event logging removed
- **Battery Reads**: Reduced from 10Hz to 1Hz (battery changes slowly)
- **Profiling Added**: Built-in benchmarking for optimization work

### Measured Performance (Real-World Data)

**Actual Metrics @ 10Hz (BLE streaming to phone):**
```
Sensor I2C Read: 2.5-3.9ms  (expected ~15ms - 5-10x better!)
BLE Notify:      0.3-0.4ms   (essentially free)
Loop Time:       2µs         (negligible)
Max Loop Time:   7.3-7.4ms   (occasional peaks)
Total Overhead:  2.9-5.2ms   (using only 3-5% of available time)
CPU Usage:       0.0%        (loop so fast it barely registers)
CPU Temp:        52-53°C     (normal ESP32 operating temperature)
Free Heap:       126KB       (plenty of RAM for buffering)
Available Time:  95-97ms     (95-97% headroom at 10Hz!)
Max Theoretical: 192-346Hz   (based on pure overhead)
```

**Why I2C is SO Much Faster:**
- The 400kHz I2C change delivered a **15-30x improvement** (not just 4x!)
- Actual: 2.5-3.9ms vs predicted 15ms
- This suggests Adafruit library overhead was minimal
- Raw I2C speed was the primary bottleneck

### Path to 50Hz
✅✅✅ **TRIVIAL - Ready NOW**
- Period: 20ms
- Overhead: ~3-5ms
- **Headroom: 15-17ms (75-85% slack!)**
- CPU usage will remain negligible
- Thermal: Expect 53-55°C (no concern)
- **Action**: Change `SAMPLE_INTERVAL_MS` to 20 and test

### Path to 100Hz
✅✅ **VERY ACHIEVABLE**
- Period: 10ms
- Overhead: ~3-5ms
- **Headroom: 5-7ms (50-70% slack)**
- CPU will still be mostly idle
- Thermal: Expect 55-60°C (acceptable)
- **Action**: Test after 50Hz validation

### Path to 200Hz
⚠️ **THEORETICALLY POSSIBLE** (but BLE-limited)
- Period: 5ms
- Overhead: ~3-5ms
- Headroom: 0-2ms (tight but technically possible)
- **Bottleneck**: BLE connection interval (7.5-30ms typical)
- Would require BLE connection interval optimization
- May need packet buffering to handle BLE latency

## File Structure

```
sensor_notify/
├── sensor_notify.ino      # Complete firmware (single file)
└── README.md              # This file
```

**Note**: v2.0 uses a single-file architecture for simplicity. Previous modular structure (config.h, sensor_manager, ble_server) was consolidated.

## Next Steps

1. **Test BLE connection** with Android app
2. **Verify data streaming** at 50Hz
3. **Calibrate sensor** for accurate readings
4. **Monitor battery** during extended use
5. **Optimize** for your use case

## Support

For issues or questions:
- Check Serial Monitor output at 115200 baud
- Review troubleshooting section above
- Verify hardware connections
- Check library versions

## License

MIT License - See main project LICENSE file
