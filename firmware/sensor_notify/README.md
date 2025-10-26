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

#### 1. Sensor Data (NOTIFY + READ)
**UUID**: `12345678-1234-5678-1234-56789abcdef1`

Binary packet (73 bytes):
- Timestamp (4 bytes) - `uint32_t` milliseconds since boot
- Quaternion (16 bytes) - 4× `float` (w, x, y, z)
- Euler Angles (12 bytes) - 3× `float` (roll, pitch, yaw in degrees)
- Acceleration (12 bytes) - 3× `float` (x, y, z in m/s²)
- Gyroscope (12 bytes) - 3× `float` (x, y, z in rad/s)
- Magnetometer (12 bytes) - 3× `float` (x, y, z in µT)
- Calibration (4 bytes) - 4× `uint8_t` (sys, gyro, accel, mag: 0-3)
- Temperature (1 byte) - `int8_t` (°C)

#### 2. Battery Level (NOTIFY + READ)
**UUID**: `00002a19-0000-1000-8000-00805f9b34fb` (Standard Battery Service)

Data: 1 byte (0-100%)

#### 3. Calibration Status (NOTIFY + READ)
**UUID**: `12345678-1234-5678-1234-56789abcdef2`

Data: 4 bytes (system, gyro, accel, mag: each 0-3)

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

### Performance Monitoring

Watch Serial Monitor for loop performance:
```
[PERF] Loop #1000: 1250.5 loops/sec
```

Target: >1000 loops/sec for smooth 50Hz sampling

## File Structure

```
sensor_notify/
├── sensor_notify.ino      # Main firmware
├── config.h               # Configuration
├── sensor_manager.h       # Sensor interface
├── sensor_manager.cpp     # Sensor implementation
├── ble_server.h           # BLE interface
├── ble_server.cpp         # BLE implementation
└── README.md              # This file
```

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
