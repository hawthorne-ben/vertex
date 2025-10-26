# Quick Testing Guide - BNO055 Web Server

## TL;DR - 5 Steps to Test

1. **Configure WiFi** - Edit `bno055_webserver.ino` with your network credentials
2. **Upload** `bno055_webserver.ino` to Feather ESP32 V2
3. **Check Serial Monitor** (115200 baud) - should show "WiFi connected" with IP address
4. **Open browser** → visit the IP address shown in Serial Monitor
5. **See dashboard** with live sensor data updating every 100ms

**Important**: Device connects to YOUR WiFi network, not creating its own access point.

## Verification Checklist

- [ ] Sensor detected in Serial Monitor
- [ ] WiFi access point created ("IMU_Logger")
- [ ] Can connect to network
- [ ] Dashboard loads in browser
- [ ] Data updates in real-time
- [ ] Moving sensor changes values
- [ ] Green dot shows "Connected" status

## Expected Serial Output

```
========================================
    BNO055 Web Server
========================================

[SETUP] Initializing sensor... OK
[SETUP] Connecting to WiFi: YourNetworkName
.....
[OK] WiFi connected!
[INFO] IP Address: 192.168.1.123
[INFO] Signal Strength (RSSI): -45 dBm
[INFO] Web server started!

========================================
Ready! Visit:
http://192.168.1.123
========================================
```

## Expected Dashboard

Modern UI with six cards showing:
- 📐 Orientation (Roll/Pitch/Yaw)
- ⚡ Acceleration (X/Y/Z)
- 🌀 Gyroscope (X/Y/Z)
- ✅ Calibration (System/Gyro/Accel/Mag)
- 🔢 Quaternion (W/X/Y/Z)
- ℹ️ Info (Uptime/Last Update)

All values update every 100ms with responsive design.

## Common Issues

| Problem | Solution |
|---------|----------|
| Can't connect to WiFi | Check your network credentials in the sketch (must be 2.4GHz) |
| Sensor not detected | Check STEMMA QT cable connection |
| Page doesn't load | Make sure both devices are on same WiFi network |
| Data shows zeros | Move sensor to calibrate (wait 5-10 seconds) |
| Wrong IP address | Check Serial Monitor - IP is assigned by your router |

## Full Documentation

- Complete guide: `README.md`
- Connection help: `BNO055_CONNECTION_GUIDE.md`
- Debugging: `TROUBLESHOOTING.md`
