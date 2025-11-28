# Vertex IMU Firmware

ESP32-based BLE streaming firmware for cycling dynamics analysis.

## Quick Start

```bash
# Navigate to firmware directory
cd firmware/imu_manager

# Compile
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32_v2 imu_manager.ino

# Upload (adjust port as needed)
arduino-cli upload \
  --fqbn esp32:esp32:adafruit_feather_esp32_v2 \
  --port /dev/cu.usbserial-XXXXXXXX \
  --upload-property upload.speed=115200 \
  imu_manager.ino

# Monitor
arduino-cli monitor --port /dev/cu.usbserial-XXXXXXXX --config baudrate=115200
```

## What It Does

The Vertex IMU Manager streams high-frequency motion data from a BNO055 9-axis sensor over Bluetooth LE to the Vertex Android app. It includes:

- **25Hz IMU streaming** - Euler angles, acceleration, gyroscope data
- **Integrated tail light** - 7-LED NeoPixel with automatic brake detection
- **Battery management** - Voltage monitoring and auto-shutdown protection
- **Wireless configuration** - Adjust sample rate and LED modes via BLE

## Hardware

- **Microcontroller**: Adafruit Feather ESP32 V2
- **Sensor**: BNO055 9-DOF IMU (via I2C STEMMA port)
- **Tail Light**: NeoPixel Jewel 7
- **Battery**: 3.7V LiPo (500-2500mAh)
- **Power**: 3.7V to 5V boost converter for NeoPixels

See [README_FIRMWARE.md](./README_FIRMWARE.md) for complete wiring diagrams.

## Development Setup

### Install Arduino CLI

```bash
brew install arduino-cli  # macOS
```

### Install Dependencies

```bash
arduino-cli core install esp32:esp32
arduino-cli lib install "Adafruit BNO055"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "Adafruit NeoPixel"
```

## Documentation

- **[README_FIRMWARE.md](./README_FIRMWARE.md)** - Complete firmware documentation
- **[imu_manager/README.md](./imu_manager/README.md)** - Detailed module documentation
- **[BNO055_CONNECTION_GUIDE.md](./BNO055_CONNECTION_GUIDE.md)** - Wiring guide
- **[HOW_TO_CALIBRATE.md](./HOW_TO_CALIBRATE.md)** - Sensor calibration
- **[I2C_TROUBLESHOOTING.md](./I2C_TROUBLESHOOTING.md)** - I2C debugging
- **[SENSOR_EXPLAINED.md](./SENSOR_EXPLAINED.md)** - Understanding BNO055 data
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** - General troubleshooting
- **[BATTERY_VOLTAGE_DIAGNOSIS.md](./BATTERY_VOLTAGE_DIAGNOSIS.md)** - Battery issues

## Configuration

All settings are in `imu_manager/config.h`:

```cpp
#define BLE_DEVICE_NAME "Vertex-IMU"          // BLE device name
#define DEFAULT_SAMPLE_INTERVAL_MS 40         // 25Hz default
#define NEOPIXEL_NUM_PIXELS 7                 // Number of LEDs
#define BATTERY_CUTOFF_VOLTAGE 3.2            // Auto-shutdown voltage
#define BRAKE_ACCEL_THRESHOLD 3.0             // Brake detection (g-force)
```

## Features

### BLE Streaming
- Real-time sensor data at 25Hz (adjustable 1-50Hz)
- 47-byte binary packets for efficiency
- Automatic MTU negotiation (185 bytes)
- Connection status monitoring

### Tail Light
- 7-LED visual status indication
- Automatic brake detection (3.0g threshold)
- Attention-grabbing strobe pattern during braking
- Configurable modes: Off / Status / Always-on

### Power Management
- Battery voltage monitoring (every 1 second)
- Critical battery auto-shutdown (3.2V)
- User button shutdown (hold 2+ seconds)
- Deep sleep mode with wake-on-reset

## Battery Life

| Capacity | With NeoPixels | LEDs Off |
|----------|---------------|----------|
| 500mAh   | ~5-8 hours    | ~6-10 hours |
| 1200mAh  | ~12-19 hours  | ~15-24 hours |
| 2500mAh  | ~25-40 hours  | ~31-50 hours |

## BLE Protocol

**Service UUID**: `12345678-1234-5678-1234-56789abcdef0`

**Sensor Data Characteristic** (NOTIFY + READ):
- UUID: `12345678-1234-5678-1234-56789abcdef1`
- 47 bytes: timestamp, euler, accel, gyro, calibration, battery

**Configuration Characteristic** (WRITE):
- UUID: `12345678-1234-5678-1234-56789abcdef2`
- Commands: Set sample rate, LED mode, power mode, reset

See [README_FIRMWARE.md](./README_FIRMWARE.md) for complete protocol specification.

## Project Structure

```
firmware/
├── imu_manager/              # Main firmware (current/active)
│   ├── imu_manager.ino       # Arduino sketch entry point
│   ├── config.h              # All configuration constants
│   ├── ble_manager.h/cpp     # BLE GATT server
│   ├── sensor_manager.h/cpp  # BNO055 interface
│   ├── power_manager.h/cpp   # Battery and shutdown
│   ├── neopixel_manager.h/cpp # LED control and brake detection
│   └── performance.h/cpp     # Performance monitoring
├── README.md                 # This file
├── README_FIRMWARE.md        # Complete firmware documentation
└── [documentation files]     # Additional guides
```

## Troubleshooting

**Sensor not detected**:
- Check I2C wiring (SDA=GPIO22, SCL=GPIO23)
- Verify 3.3V power supply
- Ensure I2C address is 0x28

**BLE connection issues**:
- Attach external 2.4GHz antenna
- NeoPixels cause RF interference without antenna
- Check device name is "Vertex-IMU"

**NeoPixels not working**:
- Verify 5V boost converter is connected
- Check data line to GPIO 13
- Ensure common ground

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for more help.

## Compilation Stats

```
Program storage: 1,180,619 bytes (35% of 3.3MB flash)
RAM usage:          42,092 bytes (12% of 320KB)
```

Plenty of headroom for additional features and sensors.

## Version

Current firmware version: **v0.3.0**

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## License

MIT License - See main project LICENSE file
