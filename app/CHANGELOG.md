# Android App Changelog

All notable changes to the Vertex Android app will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-10-28

### Added
- Initial alpha release
- BLE device discovery and connection
- Real-time IMU data streaming from Vertex sensor
- CSV file recording with session metadata
- Dark mode support with system theme detection
- Dashboard with recent recordings and statistics
- Data visualization with 3D IMU orientation display
- Device management (save, forget, reconnect)
- Recording session management with zero-point calibration
- File management (view, share, delete recordings)
- User authentication with Supabase
- Profile management and settings
- Custom UI component library (9 reusable components)
- Type-safe architecture with TypeScript
- Error handling with user-friendly messages

### Technical Details
- React Native 0.82.1
- TypeScript for type safety
- BLE communication via react-native-ble-plx
- File operations via react-native-fs
- Custom component library with dark mode
- Context API for state management
- CSV format for data export (VTX format planned for v0.2.0)
