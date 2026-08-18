# Vertex Android Companion App

React Native Android application for real-time IMU data recording from Vertex cycling sensors.

![Version](https://img.shields.io/badge/version-0.1.0-blue?style=flat-square)
![Status](https://img.shields.io/badge/status-alpha-orange?style=flat-square)

## Overview

The Vertex Android app connects via Bluetooth Low Energy (BLE) to custom IMU cycling devices. It receives batched sensor data and logs it to local CSV files for later analysis. The app operates reliably in the background during cycling activities.

## Features

### BLE Device Management
- **Device Discovery**: Scan for nearby BLE peripherals
- **Connection Management**: Connect, maintain, and handle disconnections gracefully
- **Device Persistence**: Save and manage multiple devices
- **Real-time Streaming**: Subscribe to IMU data notifications

### Data Recording
- **Session-based Logging**: Start/stop recording sessions
- **CSV Export**: Save data as `.csv` files with custom filenames
- **Metadata**: Include device info, calibration, and session notes
- **Zero-point Calibration**: Set reference points for relative measurements

### Data Visualization
- **3D IMU Display**: Real-time orientation visualization
- **Live Sensor Readings**: View acceleration, gyroscope, magnetometer data
- **Recording History**: Browse and manage past recordings
- **Data Detail View**: Analyze individual recording sessions

### User Experience
- **Dark Mode**: Full dark mode support with system detection
- **Custom UI Library**: 9 reusable components for consistent design
- **Authentication**: User accounts with Supabase integration
- **Error Handling**: User-friendly error messages and toast notifications

## Tech Stack

- **Framework**: React Native 0.82.1
- **Language**: TypeScript
- **BLE**: `react-native-ble-plx`
- **File System**: `react-native-fs`
- **Navigation**: React Navigation (stack + tabs)
- **State**: React Context API + hooks
- **Authentication**: Supabase
- **3D Graphics**: expo-gl + expo-three
- **Icons**: lucide-react-native

## Project Structure

```
android/
├── src/
│   ├── components/
│   │   ├── ui/                      # Reusable UI component library
│   │   │   ├── BackButton.tsx       # Consistent back navigation
│   │   │   ├── Badge.tsx            # Status indicators
│   │   │   ├── Button.tsx           # Primary/secondary/danger variants
│   │   │   ├── Card.tsx             # Container components
│   │   │   ├── ConfirmDialog.tsx    # Confirmation dialogs
│   │   │   ├── EmptyState.tsx       # Empty state pattern
│   │   │   ├── ErrorBanner.tsx      # Error messages
│   │   │   ├── Input.tsx            # Form inputs with validation
│   │   │   ├── Modal.tsx            # Bottom sheet modals
│   │   │   └── StatCard.tsx         # Statistics display
│   │   ├── ErrorBoundary.tsx        # Error boundary wrapper
│   │   ├── LoadingScreen.tsx        # Loading state
│   │   └── IMUVisualization3D.tsx   # 3D IMU display
│   ├── contexts/
│   │   ├── AuthContext.tsx          # Authentication state
│   │   ├── ThemeContext.tsx         # Dark mode & theme
│   │   └── ToastContext.tsx         # Toast notifications
│   ├── navigation/
│   │   ├── AppNavigator.tsx         # Stack navigation
│   │   └── TabNavigator.tsx         # Bottom tab navigation
│   ├── screens/                     # 10 screens
│   │   ├── DashboardScreen.tsx      # Main dashboard
│   │   ├── DataDetailScreen.tsx     # Recording details
│   │   ├── DataScreen.tsx           # Recording list
│   │   ├── DeviceDetailScreen.tsx   # Device details
│   │   ├── DevicesScreen.tsx        # BLE device list
│   │   ├── LandingScreen.tsx        # Landing page
│   │   ├── LoginScreen.tsx          # Authentication
│   │   ├── ProfileScreen.tsx        # User profile
│   │   ├── RecordScreen.tsx         # Active recording
│   │   └── RidesScreen.tsx          # Ride history
│   ├── services/
│   │   ├── BleService.ts            # BLE operations
│   │   ├── FileService.ts           # File management
│   │   └── RecordingService.ts      # Recording sessions
│   ├── styles/
│   │   ├── theme.ts                 # Light theme
│   │   └── theme.dark.ts            # Dark theme
│   ├── types/
│   │   ├── api.types.ts             # API types
│   │   ├── components.types.ts      # Component props
│   │   ├── errors.types.ts          # Error classes
│   │   ├── navigation.types.ts      # Navigation types
│   │   └── theme.types.ts           # Theme types
│   ├── utils/
│   │   └── errorUtils.ts            # Error handling
│   └── lib/
│       └── supabase.ts              # Supabase client
├── android/                          # Native Android code
├── ios/                              # Native iOS code (future)
├── App.tsx                           # Main entry point
├── package.json                      # Dependencies
├── CHANGELOG.md                      # Version history
└── SETUP.md                          # Detailed setup guide
```

## Architecture

### Component System

Custom UI component library built on React Native primitives:
- **9 reusable components** eliminate ~500 lines of duplicate code
- **Variant-based styling** for consistent visual hierarchy
- **Type-safe props** with TypeScript interfaces
- **Theme-aware** - all components support light/dark modes

### State Management

- **Context API** for global state (Auth, Theme, Toast)
- **Local state** with hooks for screen-specific state
- **AsyncStorage** for persistence (theme, saved devices)

### Theme System

- **Light & Dark modes** with full color palettes
- **System theme detection** - auto-detects device preference
- **Manual toggle** in ProfileScreen
- **Persistent** - saved across app restarts
- **Semantic colors** - background, foreground, primary, error, success

### Typography

- **Serif font** - Headers, titles, labels, UI text, buttons
- **Monospace font** - Numerical data, status values, file names, dates

### Error Handling

- **Custom error classes** (BleError, RecordingError, AuthError)
- **User-friendly messages** via errorUtils
- **Toast notifications** replace Alert.alert
- **Error boundaries** catch unhandled errors

### Type Safety

- **~95% type coverage** with TypeScript
- **Strict type checking** eliminates runtime errors
- **Type-safe navigation** with param lists
- **No `any` types** in new code

## Getting Started

### Prerequisites

1. **Node.js** 18+
2. **Android SDK** (via command line tools or Android Studio)
3. **React Native CLI**: `npm install -g react-native-cli`
4. **Android Device or Emulator**

### Installation

See [SETUP.md](./SETUP.md) for detailed setup instructions.

**Quick Start:**

```bash
# From monorepo root
cd android
npm install

# Connect Android device or start emulator
adb devices

# Run the app
npm run android
```

### Development

```bash
# Start Metro bundler
npm start

# Run on Android (in another terminal)
npm run android

# Run tests
npm test

# Lint code
npm run lint
```

### Environment Variables

Create `.env` file:

```env
# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_anon_key

# Optional: BLE Configuration
BLE_SERVICE_UUID=12345678-1234-5678-1234-56789abcdef0
BLE_CHARACTERISTIC_UUID=12345678-1234-5678-1234-56789abcdef1
```

## Building Release

```bash
# Build release APK
npm run build:release
# or
./build-release.sh

# Output: android/app/build/outputs/apk/release/app-release.apk
```

## Version

Current version: **v0.1.0** (Alpha)

See [CHANGELOG.md](./CHANGELOG.md) for version history.

## Documentation

- **[SETUP.md](./SETUP.md)** - Detailed setup instructions
- **[ENV_SETUP.md](./ENV_SETUP.md)** - Environment configuration
- **[CHANGELOG.md](./CHANGELOG.md)** - Version history
- **[../docs/](../docs/)** - Monorepo documentation

## Future Enhancements

- **Automatic reconnection** on disconnect
- **Real-time data sync** with web platform
- **Advanced data filters** and processing
- **iOS support** (React Native enables this)
- **Offline mode** improvements
- **VTX binary format** support (v0.2.0)

## Contributing

This is part of the Vertex monorepo. See [../README.md](../README.md) for monorepo structure and versioning.

## License

MIT
