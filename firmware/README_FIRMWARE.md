# Vertex Firmware

ESP32-based firmware for BLE IMU data streaming with integrated tail light.

## Overview

The Vertex IMU Manager provides real-time motion data streaming over Bluetooth LE for cycling dynamics analysis. It combines a 9-axis IMU sensor with an integrated NeoPixel tail light that includes automatic brake detection.

**Current Version**: v0.3.0

## Hardware Requirements

**Microcontroller**: Adafruit Feather ESP32 V2
**Sensor**: BNO055 9-DOF Absolute Orientation IMU
**Tail Light**: NeoPixel Jewel 7 (RGBW)
**Battery**: 3.7V LiPo (500-2500mAh)
**Antenna**: External 2.4GHz antenna (recommended for reliable BLE with NeoPixels)
**5V Boost**: 3.7V to 5V boost converter for NeoPixel power

### Wiring

```
BNO055  →  Feather ESP32 V2
----------------------------
VIN     →  3V (3.3V power)
GND     →  GND
SDA     →  GPIO 22 (I2C STEMMA port)
SCL     →  GPIO 23 (I2C STEMMA port)

NeoPixels  →  Feather ESP32 V2
-------------------------------
Data       →  GPIO 13
GND        →  GND
VIN (5V)   →  Boost Converter 5V output

Boost Converter (3.7V→5V)  →  Connections
-------------------------------------------
VIN        →  ESP32 BAT pin (3.7V from battery)
GND        →  Common GND
5V         →  NeoPixel VIN
EN         →  VIN (always enabled)
            OR GPIO 27 (software control, recommended)

Power Distribution
------------------
Battery (+) → ESP32 BAT pin → Boost Converter VIN
Battery (-) → Common GND
```

**Note on Power Control**:
- Connecting EN to VIN keeps NeoPixels always powered
- Connecting EN to a GPIO (e.g., Pin 27) allows software control to disable NeoPixels and save battery
- NeoPixels draw ~60mA per LED at full white brightness
- Ensure boost converter can handle total NeoPixel current draw

## Development Tools

### Arduino CLI (Recommended)

```bash
# Install
brew install arduino-cli  # macOS
# See arduino.github.io/arduino-cli for other platforms

# Setup
arduino-cli core install esp32:esp32
arduino-cli lib install "Adafruit BNO055"
arduino-cli lib install "Adafruit Unified Sensor"
arduino-cli lib install "Adafruit NeoPixel"

# Compile & Upload
cd imu_manager
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32_v2 imu_manager.ino
arduino-cli upload --fqbn esp32:esp32:adafruit_feather_esp32_v2 --port /dev/cu.usbserial-XXXXXXXX --upload-property upload.speed=115200 imu_manager.ino
```

### Serial Monitor

```bash
arduino-cli monitor --port /dev/cu.usbserial-XXXXXXXX --config baudrate=115200
```

## Features

### Data Streaming
- ✅ **BLE GATT Server** - Real-time notifications at 25Hz (optimized for stability)
- ✅ **Binary Protocol** - 47-byte efficient packets
- ✅ **MTU Negotiation** - 185-byte MTU for reliable transmission
- ✅ **Full Sensor Data** - Euler angles, accel, gyro, calibration status, battery voltage
- ✅ **Serial Logging** - Debug all operations via Serial

### NeoPixel Tail Light
- ✅ **7-LED Visual Status** - System state indication
- ✅ **Automatic Brake Detection** - On-device braking detection with attention-grabbing strobe
- ✅ **Multiple LED Modes** - Off, Status, Always-on (configurable via BLE)

### Power Management
- ✅ **Battery Monitoring** - Voltage reporting with auto-shutdown protection
- ✅ **User Button Shutdown** - Hold button for 2+ seconds
- ✅ **Deep Sleep Mode** - Ultra-low power consumption when off

## Performance

**Sample Rate**: 25Hz default (40ms interval)
**Adjustable Range**: 1-50Hz via BLE
**BLE MTU**: 185 bytes (negotiated automatically)
**Connection Stability**: External antenna required for reliable operation with NeoPixels

## Battery Life Estimates

| Capacity | Runtime (with NeoPixels) | Runtime (LEDs off) |
|----------|-------------------------|-------------------|
| 500mAh   | ~5-8 hours              | ~6-10 hours       |
| 1200mAh  | ~12-19 hours            | ~15-24 hours      |
| 2500mAh  | ~25-40 hours            | ~31-50 hours      |

## BLE Protocol

### Service UUID
```
12345678-1234-5678-1234-56789abcdef0
```

### Characteristics

**Sensor Data** (NOTIFY + READ):
- UUID: `12345678-1234-5678-1234-56789abcdef1`
- 47-byte binary packet (little-endian)
- Timestamp (4B), euler (12B), accel (12B), gyro (12B), calibration (3B), battery voltage (4B)

**Configuration** (WRITE):
- UUID: `12345678-1234-5678-1234-56789abcdef2`
- Commands:
  - `0x01 [uint32_t interval_ms]` - Set sample rate (20-1000ms)
  - `0x02` - Trigger calibration status report
  - `0x03 [uint8_t mode]` - Set power mode (0=low, 1=normal, 2=high)
  - `0x04` - Reset device
  - `0x05 [uint8_t mode]` - Set LED mode (0=off, 1=status, 2=always-on)
  - `0xFF` - Query current configuration

## NeoPixel Visual Feedback

### LED Layout
- **Center LED (0)**: Status indicator
- **Outer Ring (1-6)**: Animation/tail light pattern

### State Behaviors

| State | Center LED | Outer Ring | Description |
|-------|-----------|------------|-------------|
| **BOOTING** | Yellow pulse (0.5Hz, 15%) | White spinner (60ms/LED) with fade trail (15%) | System initialization (0-2s) |
| **BROADCASTING** | Green pulse (0.5Hz, 15%) | White spinner (60ms/LED) with fade trail (15%) | Waiting for BLE connection |
| **CONNECTED** | Blue solid (15%) | Blue spinner (60ms/LED) with fade trail (15%) | Connected, waiting for data stream |
| **OPERATING** | Red flash (synced) | Red flash (synced) | All 7 LEDs: 100ms bright → 100ms off → 20ms dim → 780ms off (1Hz) |
| **BRAKING** | Red strobe (synced) | Red strobe (synced) | All 7 LEDs: 500ms fast strobe (10Hz) → 1500ms solid red |
| **ERROR** | Red fast blink (4Hz, 15%) | Red slow pulse (breathe, 15%) | Sensor error or system fault |

## Automatic Brake Detection

The firmware includes on-device brake detection using the BNO055's linear acceleration sensor (gravity-compensated).

### Detection Parameters
- **Threshold**: 3.0g (29.43 m/s²) on X-axis
- **Debounce**: 250ms sustained acceleration
- **Display Duration**: 2 seconds total (500ms strobe + 1500ms solid)
- **Noise Immunity**: Uses gravity-compensated linear acceleration

### Tuning

Adjust sensitivity in `config.h`:
```cpp
#define BRAKE_ACCEL_THRESHOLD 3.0    // g-force threshold
#define BRAKE_DEBOUNCE_MS 250        // milliseconds of sustained braking
#define BRAKE_DISPLAY_DURATION_MS 2000  // total brake light display time
```

## Configuration

Edit `imu_manager/config.h`:

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

## File Structure

```
imu_manager/
├── imu_manager.ino         # Main entry point
├── config.h                # Configuration constants
├── ble_manager.h/cpp       # BLE GATT server
├── sensor_manager.h/cpp    # BNO055 sensor interface
├── power_manager.h/cpp     # Battery, button, shutdown
├── neopixel_manager.h/cpp  # NeoPixel control
├── performance.h/cpp       # Performance monitoring
└── README.md               # Detailed documentation
```

## Compilation Statistics

```
Program storage: 1,180,619 bytes (35% of 3.3MB flash)
RAM usage:          42,092 bytes (12% of 320KB)
```

**Plenty of headroom for:**
- Additional sensors
- Data buffering
- Enhanced BLE services
- OTA updates

## Troubleshooting

### Sensor Not Found
**Check**:
- Wiring (SDA=22, SCL=23, 3.3V, GND)
- I2C address (should be 0x28)
- Power supply voltage (3.3V)

### BLE Not Discoverable
**Solutions**:
1. Attach external antenna (NeoPixels cause RF interference)
2. Check phone Bluetooth is enabled
3. Restart device and phone
4. Look for "Vertex-IMU" in scan results

### NeoPixels Not Working
**Check**:
- 5V power connected (requires boost converter from LiPo)
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

## Known Issues

1. **RF Interference**: NeoPixels on GPIO 13 cause BLE interference
   - **Solution**: Use external 2.4GHz antenna

2. **GPIO 13 Shared**: Status LED and NeoPixel data on same pin
   - **Impact**: Simple digitalWrite() no longer works for status
   - **Solution**: NeoPixel center LED now serves as status indicator

## License

MIT License - See main project LICENSE file
