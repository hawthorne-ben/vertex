# Quick Usage Guide

## Setup (One-Time)

1. **Configure WiFi** in `config.h`:
   ```cpp
   const char* WIFI_SSID = "YourNetworkName";
   const char* WIFI_PASSWORD = "YourPassword";
   ```

2. **Set timezone** in `config.h`:
   ```cpp
   const long GMT_OFFSET_SEC = -28800;  // Your timezone offset
   ```

3. **Upload firmware**:
   - Open `bno055_dual_mode.ino` in Arduino IDE
   - Select Adafruit Feather ESP32 V2 board
   - Upload

## Daily Use

### Morning Routine (Charging)

1. **Plug in USB** → Device boots into charging mode
2. LED turns **blue** (WiFi connecting)
3. LED turns **green** (ready)
4. Check calibration status:
   - **White LED** = fully calibrated ✓
   - **Yellow LED** = calibrating...
   - **Green LED** = connected but not calibrated
5. Open browser to IP shown in Serial Monitor
6. View sensor data in web dashboard
7. Calibrate if needed (see `CALIBRATION_GUIDE.md`)

### Before Ride (Transition to Logging)

1. **Unplug USB**
2. Device switches to logging mode
3. LED status:
   - **Green breathing** = logging active ✓
   - **Yellow blink** = calibrating...
   - **Red fast blink** = NOT calibrated!
4. If red, reconnect USB and calibrate

### After Ride (Stop Logging)

1. **Plug in USB** to stop logging
2. Device transitions back to charging mode
3. Remove SD card to download logs

## LED Reference

| Pattern | Meaning |
|---------|---------|
| **Blue solid** | Connecting to WiFi |
| **Green solid** | WiFi connected |
| **Orange solid** | Syncing time |
| **White solid** | Fully calibrated (charging) |
| **Yellow blink** | Calibrating |
| **Red fast blink** | NOT calibrated |
| **Green breathing** | Logging active |
| **Blue double blink** | File rotation |

## Calibration Check

Check calibration status on web dashboard or via Serial Monitor:

```
System: 3  Gyro: 3  Accel: 3  Mag: 3  ✓ Fully calibrated
```

Need to calibrate? See `CALIBRATION_GUIDE.md`

## Common Issues

**LED blinking red when unplugging USB:**
- Sensor not calibrated
- Calibrate while USB connected

**Logging not starting:**
- Check SD card is inserted
- Check Serial Monitor for errors

**WiFi won't connect:**
- Check credentials in `config.h`
- Ensure 2.4GHz network (not 5GHz)

## Log Files

Logs saved to SD card as: `YYYYMMDD_HHMMSS.csv`

CSV format includes all sensor data:
- Quaternions (w,x,y,z)
- Euler angles (roll, pitch, yaw)
- Linear acceleration
- Gyroscope
- Magnetometer

Files rotate every 30 minutes automatically.
