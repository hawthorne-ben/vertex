# Firmware Development Status

## Current Status: ✅ DUAL-MODE FIRMWARE WORKING

**Location**: `firmware/bno055_dual_mode/`  
**Version**: 2.1 (No LED, I2C Safe)

## Completed Work

### Core Implementation ✅
- [x] Dual-mode firmware architecture
- [x] BNO055 sensor initialization and data reading
- [x] WiFi connection and web server
- [x] NTP time synchronization
- [x] Charge detection with voltage monitoring
- [x] `/sensor` JSON endpoint
- [x] Removed LED code (I2C conflict with GPIO 2)

### Recent Fixes ✅
- [x] Fixed charge detection threshold (3.70V - observed peak at 3.78-3.79V)
- [x] Web server stability in logging mode
- [x] Reduced excessive serial logging
- [x] NTP sync enabled in logging mode (with comment for future power savings)
- [x] Simplified charging detection (removed complex history logic that caused boot loops)

### Current Features

✅ **Charging Mode** (USB connected, ≥3.70V):
- WiFi connection with web dashboard
- NTP time synchronization
- Real-time sensor data via `/sensor` JSON endpoint
- Calibration status monitoring
- Battery voltage: 3.70-3.79V when charging

✅ **Logging Mode** (Battery power, <3.70V):
- WiFi and web server ACTIVE (for development/debugging)
- Web dashboard and sensor endpoints available
- NTP sync enabled (will disable for power saving in production)
- SD card logging stub (ready for hardware)
- Calibration status checking
- Battery voltage: 3.0-3.70V typical range

✅ **Web Server Endpoints**:
- `/` - Status dashboard (10s refresh)
- `/sensor` - Real-time sensor data (JSON)

## Hardware Test Status

- [x] Sensor initialization works
- [x] WiFi connection established
- [x] Web server responds
- [x] Charge detection works (3.70V threshold)
- [ ] Test on both ESP32 Feather boards
- [ ] Verify sensor data accuracy
- [ ] Add SD card hardware
- [ ] Test SD card logging functionality

## Firmware Organization

- `bno055_v1/` - Simple web server version (working, kept for reference)
- `bno055_dual_mode_archive/` - Historical reference (broken, kept for comparison)
- `bno055_dual_mode/` - **Main working version** ⭐
- `bno055_webserver/` - Removed by user

## Lessons Learned

1. **I2C + GPIO 2 Conflict**: NeoPixel LED on GPIO 2 causes I2C timing issues
   - **Solution**: Remove LED entirely, use Serial Monitor for status
2. **Charge Detection**: Simple threshold works better than complex history tracking
   - **Threshold**: 3.70V (observed 3.78-3.79V peak when charging)
   - **Logic**: Voltage ≥3.70V = charging mode
3. **Web Server in Logging Mode**: Keep active for debugging
   - Will disable WiFi for power saving in production
4. **Keep It Simple**: Complex voltage tracking caused boot loops
   - Simple threshold detection is stable and reliable

## Next Steps

1. **Hardware Testing**:
   - Test on both boards
   - Verify charge/battery switching
   - Confirm sensor data accuracy

2. **SD Card Integration**:
   - Add SD card hardware
   - Implement actual file writing
   - Test file rotation

3. **Production Optimization**:
   - Disable WiFi in logging mode for power savings
   - Disable NTP after initial sync for power savings
   - Optimize sensor reading frequency

4. **Optional Enhancements**:
   - Add external LED on GPIO 13 (avoid GPIO 2)
   - Implement sleep modes for power saving
   - Add configuration via web UI

## Usage

**Compile**:
```bash
cd firmware/bno055_dual_mode
arduino-cli compile --fqbn esp32:esp32:featheresp32 .
```

**Upload**:
```bash
arduino-cli upload -p /dev/cu.usbserial-XXXXX --fqbn esp32:esp32:featheresp32 .
```

**Access**:
- Web dashboard: `http://<IP>/`
- Sensor data: `http://<IP>/sensor`

**Charge Detection**:
- ≥3.70V = Charging mode (USB connected)
- <3.70V = Logging mode (battery power)

## Status: ✅ Ready for Hardware Testing
