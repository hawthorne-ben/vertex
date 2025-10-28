# Firmware Changelog

All notable changes to the Vertex IMU firmware will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-28

### Added
- Initial firmware release (alpha)
- BNO055 IMU sensor integration
- BLE communication with notifications
- Power management with user button (GPIO38)
- Battery voltage monitoring
- LED status indicators
- Quaternion, Euler angles, acceleration, gyroscope, and magnetometer data
- VTX format v1.0 support in metadata

### Technical Details
- Platform: ESP32 Feather V2
- Sensor: Adafruit BNO055
- Communication: BLE (Bluetooth Low Energy)
- Sample Rate: ~10Hz (configurable)
- Power: Deep sleep when disconnected
