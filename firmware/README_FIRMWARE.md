# Vertex Firmware

ESP32-based firmware for the BNO055 IMU sensor with multiple operating modes.

## Firmware Versions

### 📡 sensor_notify/ (Current - Production)

**BLE-only streaming mode** for mobile app integration.

- ✅ **BLE GATT Server** - Real-time notifications at 10Hz (optimized for stability)
- ✅ **No WiFi** - Battery efficient, BLE-only
- ✅ **No NTP** - Phone provides timestamps
- ✅ **Binary Protocol** - 56-byte efficient packets
- ✅ **MTU Negotiation** - 185-byte MTU for reliable transmission
- ✅ **Full Sensor Data** - Euler angles, accel, gyro, mag, calibration
- ✅ **Serial Logging** - Debug all operations via Serial

**Use Case**: Mobile app receives continuous IMU data stream

**Performance**: 10Hz stable (50-100Hz capable with further optimization)

**Battery Life**: ~15-24 hours (1200mAh battery, estimated)

**Documentation**: [sensor_notify/README.md](sensor_notify/README.md)

### 🌐 bno055_dual_mode/ (Archive - Reference)

**WiFi + Web UI** dual-mode logger (charging vs battery).

- ✅ **WiFi Web Server** - Local web interface
- ✅ **NTP Time Sync** - Accurate timestamps
- ✅ **Dual Mode** - Charging mode (web UI) + Logging mode (battery)
- ⚠️ **WiFi Connectivity Issues** - Unreliable connection

**Use Case**: Development/testing with web interface

**Battery Life**: ~6-10 hours (1200mAh battery)

**Status**: Archived - WiFi connection instability, replaced by BLE approach

## Hardware

**Microcontroller**: Adafruit Feather ESP32 V2
**Sensor**: BNO055 9-DOF Absolute Orientation IMU
**Battery**: 3.7V LiPo (500-2500mAh)
**Indicator**: NeoPixel LED strip
**Power Management**: 3.7V to 5V boost converter for NeoPixels

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

# Compile & Upload
cd sensor_notify
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32_v2 sensor_notify.ino
arduino-cli upload --fqbn esp32:esp32:adafruit_feather_esp32_v2 --port /dev/cu.usbserial-59690499371 --upload-property upload.speed=115200 imu_manager.ino
```

### Serial Monitor

```bash
arduino-cli monitor --port /dev/cu.usbserial-XXXXXXXX --config baudrate=115200
```

## File Structure

```
firmware/
├── sensor_notify/              # Current BLE-only firmware
│   ├── sensor_notify.ino       # Main firmware
│   ├── config.h                # Configuration
│   ├── sensor_manager.h/cpp    # BNO055 sensor interface
│   ├── ble_server.h/cpp        # BLE GATT server
│   └── README.md               # Detailed documentation
│
├── bno055_dual_mode/           # Archived WiFi+Web firmware
│   ├── bno055_dual_mode.ino    # Main firmware
│   ├── config.h                # Configuration
│   └── ...                     # WiFi, NTP, web server modules
│
└── README_FIRMWARE.md          # This file
```

## Compilation Statistics

### sensor_notify (BLE-only)

```
Program storage: 1,160,315 bytes (34% of 3.3MB flash)
RAM usage:          41,892 bytes (12% of 320KB)
```

**Plenty of headroom for:**
- Additional sensors
- Data buffering
- Enhanced BLE services
- OTA updates

## BLE Protocol Specification

### Service UUID
```
12345678-1234-5678-1234-56789abcdef0
```

### Characteristics

**Sensor Data** (NOTIFY + READ):
- UUID: `12345678-1234-5678-1234-56789abcdef1`
- 56-byte binary packet @ 10Hz
- Timestamp (4B), euler (12B), accel (12B), gyro (12B), mag (12B), calibration (4B)

**Battery Level** (NOTIFY + READ):
- UUID: `00002a19-0000-1000-8000-00805f9b34fb` (Standard)
- 1 byte: 0-100%

**Calibration Status** (NOTIFY + READ):
- UUID: `12345678-1234-5678-1234-56789abcdef2`
- 4 bytes: system, gyro, accel, mag (each 0-3)

## Troubleshooting

### Compilation Errors

**Private method access (read8)**:
```
error: 'byte Adafruit_BNO055::read8(adafruit_bno055_reg_t)' is private
```
**Solution**: Remove direct register reads, use public API only

**String conversion**:
```
error: conversion from 'String' to 'std::string' requested
```
**Solution**: Use `.c_str()` for Arduino String to std::string

### Upload Failures

**"Chip stopped responding"**:
1. Try slower baud rate: `--upload-property upload.speed=115200`
2. Close Serial Monitor if open
3. Press RESET button on board before upload
4. Check USB cable quality

### Sensor Not Found

**Check**:
- Wiring (SDA=22, SCL=23, VCC=3V, GND=GND)
- I2C address (should be 0x28)
- Power supply voltage (3.3V)
- Run I2C scan in Serial Monitor

## Next Development Steps

1. ✅ Basic BLE streaming working
2. ⬜ Android app BLE integration
3. ⬜ Calibration data persistence (EEPROM)
4. ⬜ OTA firmware updates
5. ⬜ Additional sensors (GPS, barometer)
6. ⬜ Data compression for extended logging

## License

MIT License - See main project LICENSE file
