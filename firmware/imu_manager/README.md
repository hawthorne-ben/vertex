# Vertex IMU Manager Firmware

**BLE-based IMU sensor streaming with NeoPixel tail light**

Version: 0.3.0

## Quick Start

```bash
# Compile
cd firmware/imu_manager
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

## Overview

Modular firmware for BLE-based IMU sensor streaming with integrated NeoPixel tail light. Designed for the Vertex Android app to receive real-time motion data from the BNO055 sensor.

### Key Features

- ✅ **BLE Notify Server** - Real-time sensor streaming (25Hz default)
- ✅ **Configurable Sample Rate** - 1-50Hz via BLE commands
- ✅ **NeoPixel Tail Light** - 7-LED visual status and tail light
- ✅ **Automatic Brake Detection** - On-device braking detection with attention-grabbing strobe pattern
- ✅ **Battery Monitoring** - Voltage reporting with auto-shutdown protection
- ✅ **Power Management** - User button for shutdown
- ✅ **Calibration Status** - Real-time sensor calibration feedback
- ✅ **Dynamic Configuration** - Change settings via BLE without reflashing

## Hardware Requirements

- **Microcontroller**: Adafruit Feather ESP32 V2
- **Sensor**: BNO055 9-DOF Absolute Orientation IMU
- **Tail Light**: NeoPixel Jewel 7 (RGBW)
- **Battery**: 3.7V LiPo (500-2500mAh)
- **Antenna**: External 2.4GHz antenna (recommended for reliable BLE with NeoPixels)
- **5V Boost**: Adafruit MiniBoost 5V @ 1A (for NeoPixel power)

### Wiring

```
BNO055  →  Feather ESP32 V2
----------------------------
VIN     →  3V (3.3V power)
GND     →  GND
SDA     →  GPIO 22 (SDA)
SCL     →  GPIO 23 (SCL)

NeoPixel Jewel 7  →  Connections
----------------------------------
5V      →  MiniBoost VOUT (5V from LiPo boost)
GND     →  GND (common ground)
DIN     →  GPIO 13 (data)

MiniBoost  →  Connections
--------------------------
VIN     →  LiPo BAT+ (3.7V)
GND     →  LiPo BAT- / common GND
VOUT    →  NeoPixel 5V

LiPo Battery  →  Connections
-----------------------------
BAT+    →  Feather BAT, MiniBoost VIN (parallel)
BAT-    →  Common GND
```

**Note**: Use screw terminal blocks or perma-proto board to split battery connections cleanly.

## NeoPixel Visual Feedback

The 7-LED NeoPixel Jewel provides system status indication:

### LED Layout
- **Center LED (0)**: Status indicator
- **Outer Ring (1-6)**: Animation/tail light pattern

### State Behaviors

| State | Center LED | Outer Ring | Description |
|-------|-----------|------------|-------------|
| **BOOTING** | Yellow pulse (0.5Hz, 15% brightness) | White spinner (60ms/LED) with fade trail (15%) | System initialization (0-2s) - smooth rotating animation |
| **BROADCASTING** | Green pulse (0.5Hz, 15% brightness) | White spinner (60ms/LED) with fade trail (15%) | Waiting for BLE connection - smooth rotating animation |
| **CONNECTED** | Blue solid (15% brightness) | Blue spinner (60ms/LED) with fade trail (15%) | Connected, waiting for data stream |
| **OPERATING** | Red flash (synced) | Red flash (synced) | All 7 LEDs: 100ms bright → 100ms off → 20ms dim → 780ms off (1Hz cycle) |
| **BRAKING** | Red strobe (synced) | Red strobe (synced) | All 7 LEDs: 500ms fast strobe (10Hz) → 1500ms solid red (full brightness) |
| **ERROR** | Red fast blink (4Hz, 15% brightness) | Red slow pulse (breathe, 15%) | Sensor error or system fault |

**Operating Mode Tail Light Pattern:**
- Synchronized flash on all 7 LEDs for maximum visibility
- 10% bright / 10% off / 2% dim / 78% off @ 1Hz
- No rotation - all LEDs pulse together

**LED Mode Control:**
- 0 = OFF (all LEDs disabled, saves power)
- 1 = STATUS (default, shows system state as above)
- 2 = ALWAYS-ON (center LED solid blue, outer ring status pattern)

Change LED mode via BLE config characteristic (command 0x05).

## Automatic Brake Detection

The firmware includes on-device brake detection using the BNO055's linear acceleration sensor (gravity-compensated).

### Detection Parameters

- **Threshold**: 3.0g (29.43 m/s²) on X-axis
- **Debounce**: 250ms sustained acceleration (6-7 samples at 25Hz)
- **Display Duration**: 2 seconds total
- **Noise Immunity**: Uses gravity-compensated linear acceleration to filter vibrations

### Brake Light Pattern

When braking is detected:
1. **First 500ms**: Fast 10Hz strobe (50ms on, 50ms off) for immediate attention
2. **Remaining 1500ms**: Solid red at full brightness for sustained visibility

### Priority

The BRAKING state has high priority and overrides all normal tail light patterns except ERROR state. This ensures brake lights are always visible regardless of connection status.

### Tuning

To adjust sensitivity, modify these constants in `config.h`:
```cpp
#define BRAKE_ACCEL_THRESHOLD 3.0    // g-force threshold (increase to reduce sensitivity)
#define BRAKE_DEBOUNCE_MS 250        // milliseconds of sustained braking
#define BRAKE_DISPLAY_DURATION_MS 2000  // total brake light display time
```

## Software Requirements

- **Arduino CLI** (recommended) or Arduino IDE 2.0+
- **ESP32 Board Support**: v3.0.0+
- **Libraries**:
  - Adafruit BNO055
  - Adafruit Unified Sensor
  - Adafruit NeoPixel
  - ESP32 BLE Arduino (included with ESP32 core)

### Installation

```bash
# Install Arduino CLI
brew install arduino-cli  # macOS

# Install ESP32 board support
arduino-cli core install esp32:esp32

# Install required libraries
arduino-cli lib install "Adafruit BNO055"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "Adafruit NeoPixel"
```

## Configuration

Edit `config.h` to customize:

```cpp
// BLE Device Name
#define BLE_DEVICE_NAME "Vertex-IMU"

// Sample Rate (adjustable 1-50Hz)
#define DEFAULT_SAMPLE_INTERVAL_MS 40  // 25Hz default

// NeoPixel Settings
#define NEOPIXEL_DATA_PIN 13
#define NEOPIXEL_NUM_PIXELS 7
#define NEOPIXEL_UPDATE_INTERVAL_MS 100

// Battery Protection
#define BATTERY_CUTOFF_VOLTAGE 3.2  // Auto-shutdown below 3.2V
```

## BLE Service Specification

### Service UUID
```
12345678-1234-5678-1234-56789abcdef0
```

### Characteristics

#### 1. Sensor Data (NOTIFY + READ)
**UUID**: `12345678-1234-5678-1234-56789abcdef1`

Binary packet (47 bytes, little-endian):
- **Timestamp** (4 bytes) - uint32_t milliseconds since boot
- **Euler Angles** (12 bytes) - 3× float (roll, pitch, yaw in degrees)
- **Acceleration** (12 bytes) - 3× float (x, y, z in m/s²)
- **Gyroscope** (12 bytes) - 3× float (x, y, z in rad/s)
- **Calibration** (3 bytes) - 3× uint8_t (sys, gyro, accel: 0-3)
- **Battery Voltage** (4 bytes) - float (voltage in V)

**Note**: 6-DOF mode (no magnetometer) for cleaner orientation. Yaw drift corrected in post-processing using GPS.

#### 2. Configuration (WRITE)
**UUID**: `12345678-1234-5678-1234-56789abcdef2`

Commands:
- `0x01 [uint32_t interval_ms]` - Set sample rate (20-1000ms)
- `0x02` - Trigger calibration status report
- `0x03 [uint8_t mode]` - Set power mode (0=low, 1=normal, 2=high)
- `0x04` - Reset device
- `0x05 [uint8_t mode]` - Set LED mode (0=off, 1=status, 2=always-on)
- `0xFF` - Query current configuration

## Modular Architecture

```
imu_manager/
├── imu_manager.ino         # Main firmware loop
├── config.h                # All constants and configuration
├── ble_manager.h/.cpp      # BLE communication
├── sensor_manager.h/.cpp   # BNO055 sensor operations
├── power_manager.h/.cpp    # Battery, button, shutdown
├── neopixel_manager.h/.cpp # NeoPixel control
├── performance.h/.cpp      # Performance monitoring
└── README.md               # This file
```

## Power Management

- **Normal Operation**: ~60-100mA @ 3.7V (with NeoPixels)
- **Battery Monitoring**: Every 1 second
- **Critical Shutdown**: Automatic at 3.2V
- **User Shutdown**: Hold button (GPIO 38) for 2+ seconds

### Battery Life Estimates

| Capacity | Runtime (with NeoPixels) | Runtime (LEDs off) |
|----------|-------------------------|-------------------|
| 500mAh | ~5-8 hours | ~6-10 hours |
| 1200mAh | ~12-19 hours | ~15-24 hours |
| 2500mAh | ~25-40 hours | ~31-50 hours |

## Performance

- **Sample Rate**: 25Hz default (40ms interval)
- **Adjustable Range**: 1-50Hz via BLE
- **BLE MTU**: 185 bytes (negotiated automatically)
- **Connection Stability**: External antenna required for reliable operation with NeoPixels

## Troubleshooting

### Sensor Not Found
**Check**:
- Wiring (SDA=22, SCL=23, 3.3V, GND)
- I2C address (should be 0x28)

### BLE Not Discoverable
**Solutions**:
1. Attach external antenna (NeoPixels cause RF interference)
2. Check phone Bluetooth is enabled
3. Restart device and phone
4. Look for "Vertex-IMU" in scan results

### NeoPixels Not Working
**Check**:
- 5V power connected (requires USB or 5V boost from LiPo)
- Data line connected to GPIO 13
- Common ground between all components

### Low Battery Performance
- Charge battery above 3.5V
- Disable NeoPixels (LED mode 0) to extend runtime
- Use larger capacity battery

## Calibration

The BNO055 requires calibration for accurate measurements:

1. **Gyroscope**: Keep still for 2-3 seconds
2. **Accelerometer**: Move through all 6 positions
3. **System**: Gyro + Accel must reach level 3

Watch Serial Monitor for status:
```
Cal: S=3 G=3 A=3  ✅ Fully calibrated
```

## File Structure

```
imu_manager/
├── imu_manager.ino         # Main entry point
├── config.h                # Configuration constants
├── ble_manager.h           # BLE interface
├── ble_manager.cpp         # BLE implementation
├── sensor_manager.h        # Sensor interface
├── sensor_manager.cpp      # Sensor implementation
├── power_manager.h         # Power interface
├── power_manager.cpp       # Power implementation
├── neopixel_manager.h      # NeoPixel interface
├── neopixel_manager.cpp    # NeoPixel implementation
├── performance.h           # Performance tracking interface
├── performance.cpp         # Performance tracking implementation
└── README.md               # This documentation
```

## Development

### Adding Custom Features

1. Modify sensor data structure in `sensor_manager.h`
2. Update BLE packet in `ble_manager.cpp`
3. Update Android app BLE parsing to match

### Debug Logging

Serial Monitor @ 115200 baud shows:
- Boot sequence
- BLE connection events
- Sensor readings (every 10th sample)
- Configuration changes
- Performance metrics (every 5s)

## Known Issues

1. **RF Interference**: NeoPixels on GPIO 13 cause BLE interference
   - **Solution**: Use external 2.4GHz antenna

2. **GPIO 13 Shared**: Status LED and NeoPixel data on same pin
   - **Impact**: Simple digitalWrite() no longer works for status
   - **Solution**: NeoPixel center LED now serves as status indicator

## License

MIT License - See main project LICENSE file
