# BNO055 Firmware v1

## Overview

This is a clean copy of the working BNO055 web server firmware. It has been tested and confirmed working.

## Status

✅ **WORKING** - Confirmed functional with sensor detection and web server

## Features

- WiFi Station Mode (connects to your home network)
- Real-time sensor data dashboard
- Automatic WiFi reconnection
- I2C error handling and recovery
- Sensor calibration display

## Usage

1. Edit `ssid` and `password` constants in `bno055_v1.ino`
2. Upload to Feather ESP32 V2
3. Connect to the IP address shown in Serial Monitor

## Next Steps

- Add dual-mode operation (charging vs logging)
- Add NTP time sync
- Add power management
- Add SD card logging

## Archive

Previous dual-mode implementation is in `../bno055_dual_mode_archive/`
