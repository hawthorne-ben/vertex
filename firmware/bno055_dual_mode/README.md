# BNO055 Dual-Mode Logger (Fixed)

**VERSION 2.1** - Fixed I2C conflict by removing LED support

## What Changed

**Problem**: NeoPixel LED on GPIO 2 conflicts with I2C on some ESP32 Feather boards, causing sensor initialization failures.

**Solution**: Removed all LED functionality. Status is now reported via Serial Monitor only.

## Key Differences from Archive

- ❌ No LED initialization
- ❌ No `led_manager` code
- ❌ No NeoPixel library
- ✅ Sensor initialization works reliably
- ✅ All other functionality intact

## Status Messages

Without the LED, all status is via Serial output:
- `[OK]` = Success
- `[ERROR]` = Error
- `[WARN]` = Warning
- `[CALIBRATION]` = Calibration values

## Why This Works

The I2C bus on ESP32 uses GPIO 21/22 for SDA/SCL. However, GPIO 2 (NeoPixel pin) can cause timing issues when both are initialized, especially with 400kHz I2C clock speeds. This is a known ESP32 hardware limitation.

## Future LED Options

If you need visual status indicators:
1. Use external LED on different GPIO (avoid GPIO 2)
2. Use built-in LED (GPIO 13 on most Feather boards)
3. Use Serial Monitor output (current approach)

## Features

### Charging Mode (USB Power)
- WiFi connection with web dashboard
- NTP time synchronization
- Real-time sensor visualization
- Calibration monitoring
- Battery status display

### Logging Mode (Battery Power)
- WiFi OFF for power saving
- SD card data logging at 50Hz
- Automatic file rotation every 30 minutes
- Calibration status checking
- Breathing LED status indicator

## Hardware Requirements

- Adafruit Feather ESP32 V2
- Adafruit BNO055 IMU (STEMMA QT/Qwiic)
- MicroSD card module (connected to SPI)
- STEMMA QT 4-pin cable
- USB cable for charging

## Configuration

1. Open `config.h`
2. Set WiFi credentials:
   ```cpp
   const char* WIFI_SSID = "YOUR_WIFI_NETWORK_NAME";
   const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
   ```
3. Adjust timezone if needed:
   ```cpp
   const long GMT_OFFSET_SEC = -28800;  // PST
   const int DAYLIGHT_OFFSET_SEC = 3600; // PDT
   ```

## Installation

### Quick Start (Recommended - No Arduino IDE!)

```bash
# Install arduino-cli (one-time)
brew install arduino-cli  # macOS
# or: curl -fsSL https://arduino.github.io/arduino-cli/install.sh | sh

# Upload firmware
cd firmware/bno055_dual_mode
./upload.sh
```

See `UPLOAD_GUIDE.md` for full instructions.

### Arduino IDE Installation (Alternative)

#### Required Libraries

1. **Adafruit BNO055** by Adafruit
2. **Adafruit Unified Sensor**
3. **Adafruit NeoPixel**

Install via Arduino IDE Library Manager.

#### Upload to ESP32

1. Open `bno055_dual_mode.ino` in Arduino IDE
2. Select board: **Tools → Board → Adafruit ESP32 Feather**
3. Select port
4. Upload sketch

## Usage

### Charging Mode (USB Connected)

1. Power on via USB
2. LED turns blue (connecting)
3. LED turns green (connected)
4. Open browser to ESP32 IP address (shown in Serial Monitor)
5. View real-time sensor data

### Logging Mode (Battery)

1. Unplug USB (or power fails)
2. LED blinks red/yellow if calibration needed
3. LED turns green breathing when logging starts
4. Data logs at 50Hz
5. Files rotate every 30 minutes

**Note**: SD card module not yet available - currently using Serial Monitor fallback. Data outputs as CSV you can copy/paste.

## LED Status Indicators

| Color | Pattern | Meaning |
|-------|---------|---------|
| Red | Solid | Error (sensor, SD card, etc.) |
| Blue | Solid | Connecting to WiFi |
| Green | Solid | WiFi connected (charging) |
| Orange | Solid | NTP syncing |
| Green | Breathing | Logging active |
| Yellow | Blink | Calibrating |
| Red | Fast Blink | Not calibrated |
| Blue | Double Blink | File rotation |

## File Structure

```
bno055_dual_mode/
├── bno055_dual_mode.ino  # Main firmware
├── config.h              # Configuration
├── led_manager.h/cpp     # LED control
├── power_manager.h/cpp   # Power detection
├── sensor_manager.h/cpp  # BNO055 interface
├── wifi_manager.h/cpp    # WiFi connection
├── web_server.h/cpp      # Web UI
├── ntp_sync.h/cpp        # Time synchronization
├── sd_logger.h/cpp       # SD card logging (Serial fallback)
├── upload.sh             # Direct upload script
├── README.md
├── USAGE.md
├── UPLOAD_GUIDE.md
└── MEMORY_ANALYSIS.md    # Memory usage analysis
```

## Log File Format

CSV format with header:
```
timestamp,qw,qx,qy,qz,roll,pitch,yaw,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z
```

Files named: `YYYYMMDD_HHMMSS.csv`

## Troubleshooting

### Sensor Not Detected
- Check STEMMA QT cable connections
- Verify I2C wiring
- Check `config.h` BNO055_ADDRESS

### WiFi Not Connecting
- Verify credentials in `config.h`
- Check 2.4GHz network (ESP32 doesn't support 5GHz)
- Check router firewall

### SD Card Issues
- Format SD card as FAT32
- Check SD_CS_PIN in `config.h`
- Verify SPI connections

### Calibration Issues
- Move sensor in figure-8 pattern for accelerometer
- Rotate sensor for gyroscope
- Move sensor in circles for magnetometer
- See `firmware/CALIBRATION_GUIDE.md`

## Calibration

See `firmware/CALIBRATION_GUIDE.md` for detailed calibration instructions.

**Quick Version:**
1. Place sensor on flat surface
2. Wait for System calibration to reach 3
3. Lift and tilt sensor for Accelerometer
4. Rotate sensor for Gyroscope
5. Make figure-8 movements for Magnetometer

## Memory Usage

- **Flash**: ~1.4MB / 4MB (35%)
- **RAM**: ~35KB / 520KB (6%)

Plenty of room for additional features.

## License

Same as parent project.
