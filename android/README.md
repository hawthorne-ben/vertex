# Vertex Android Companion App

## Overview

A simple Android application designed to connect via Bluetooth Low Energy (BLE) to a custom cycling IMU device. Its primary function is to receive batched sensor data (timestamp, grade, roll, G-force components) transmitted by the device and log this data accurately to a local file (.csv) on the phone for later analysis. The app operates reliably in the background during cycling activities.

## Core Features

### BLE Device Discovery
- Scan for nearby BLE peripherals
- Filter/Identify the specific IMU device (e.g., by advertised name or unique service UUID)
- Display a list of found devices

### BLE Connection Management
- Initiate and establish a connection to the selected IMU device
- Maintain the connection reliably
- Handle disconnections (e.g., device out of range) gracefully with status feedback
- (Optional V1.1: Automatic reconnection)

### Data Subscription & Reception
- Discover the custom BLE service and characteristic(s) on the connected IMU device
- Subscribe to notifications for the characteristic broadcasting batched IMU data
- Receive incoming data notifications (byte arrays)

### Data Parsing & Timestamping
- Decode received byte arrays into individual timestamped sensor readings (grade, roll, Gx, Gy, Gz)
- Utilize timestamps provided within the batch from the ESP32's RTC for maximum accuracy
- Fallback: timestamp the arrival of the batch on the phone if ESP32 timestamps unavailable

### Session-Based File Logging
- User controls to Start and Stop a logging "session"
- On "Start": Create a new .csv file on accessible storage
- File naming: `imu_log_YYYYMMDD_HHMMSS.csv`
- Write header row defining data columns:
  - `timestamp_ms`, `grade_percent`, `roll_deg`, `accel_x_g`, `accel_y_g`, `accel_z_g`
- Append each parsed sensor reading as a new row
- On "Stop": Close the file properly

### Background Operation
- Implement as an Android Foreground Service
- Ensure BLE connection and logging continue when app is not in foreground
- Continue operating when phone screen is off
- Display persistent notification indicating service is running

### File Management & Export
- List previously recorded .csv log files
- Share/export selected log files using Android Share Sheet (email, Google Drive, Dropbox, etc.)

## User Interface (UI)

### Main Screen
- Button to "Scan for Devices"
- List of discovered devices
- Connection status indicator (Disconnected, Connecting, Connected to [Device Name])
- Buttons to "Connect"/"Disconnect"
- Buttons to "Start Logging"/"Stop Logging"
- Indicator showing logging status and elapsed session time
- (Optional) Display latest received Grade/Roll value

### File List Screen
- List of saved .csv files
- Select file capability
- Button to "Share/Export" selected file
- Button to "Delete" selected file

## Non-Functional Requirements

- **Permissions**: Request necessary Android permissions (Bluetooth, Location - needed for BLE scanning, potentially File Storage depending on Android version)
- **Battery Efficiency**: Use BLE and background services efficiently (streaming is inherently power-intensive)
- **Error Handling**: Handle BLE connection failures, file writing issues, etc.

## Tech Stack

**React Native** - Leveraging existing React skills and JavaScript ecosystem

### Key Libraries

- **BLE**: `react-native-ble-plx` - Robust BLE API for scanning, connection, services, characteristics, and notifications
- **Background Service**: `react-native-background-actions` - Reliable background operation
- **File System**: `react-native-fs` - File operations
- **State Management**: Zustand (consistent with web app)
- **UI Styling**: NativeWind (Tailwind CSS for React Native)
- **Navigation**: React Navigation

## Development Setup

This project uses CLI-based development to avoid Android Studio.

### Prerequisites

1. **Android SDK** (via command line tools)
2. **React Native CLI**
3. **Node.js** (already installed in parent project)
4. **Android Device or Emulator**

### Installation Steps

See [SETUP.md](./SETUP.md) for detailed setup instructions.

## Project Structure

```
android/
├── README.md           # This file
├── SETUP.md            # Development environment setup guide
├── src/                # React Native source code
│   ├── components/     # React components
│   ├── services/       # BLE service, file logging service
│   ├── screens/        # Main UI screens
│   ├── utils/          # Data parsing, timestamping
│   └── navigation/     # Navigation configuration
├── android/            # Native Android configuration
└── package.json        # Dependencies and scripts
```

## Getting Started

1. Follow setup instructions in [SETUP.md](./SETUP.md)
2. Run `npm install`
3. Connect Android device or start emulator
4. Run `npm run android`

## Future Enhancements (Post V1)

- Automatic reconnection on disconnect
- Real-time sensor visualization
- Sync capabilities with web platform
- iOS support (React Native keeps this option open)

