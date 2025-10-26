# Android App Development Setup

## Prerequisites

### 1. Fix npm Permissions

Before proceeding, you need to fix the npm cache permissions issue:

```bash
sudo chown -R $(whoami) ~/.npm
```

### 2. Source Updated Environment

Reload your shell configuration:

```bash
source ~/.zshrc
```

Or start a new terminal window.

### 3. Verify Android SDK Setup

Check that ANDROID_HOME is set and SDK tools are accessible:

```bash
echo $ANDROID_HOME
# Should output: /Users/bhawthorne/Library/Android/sdk

sdkmanager --version
# Should show version information
```

### 4. Connect Android Device (or Use Emulator)

**Option A: Physical Device**
- Enable Developer Options on your Android phone
- Enable USB Debugging
- Connect device via USB
- Verify connection: `adb devices`

**Option B: Emulator**
- Install an emulator system image: `sdkmanager "system-images;android-34;google_apis;x86_64"`
- Create an AVD: `avdmanager create avd -n Pixel_8_API_34 -k "system-images;android-34;google_apis;x86_64"`
- Start emulator: `emulator -avd Pixel_8_API_34`

## React Native Project Setup

✅ **Already Completed:** The React Native project has been initialized in the `android/vertex/` directory.

The following dependencies have been installed:
- `react-native-ble-plx` - BLE communication
- `react-native-background-actions` - Background service
- `react-native-fs` - File system operations
- `@react-navigation/native` - Navigation framework
- `@react-navigation/native-stack` - Stack navigator
- `react-native-screens` - Native screen components

### 1. Navigate to Project Directory

```bash
cd /Users/bhawthorne/dev/vertex/android/vertex
```

### 2. Additional Dependencies (Optional)

If you want to add NativeWind (Tailwind CSS for React Native):

```bash
npm install nativewind
npm install tailwindcss --save-dev
```

### 3. Configure Native Modules

React Native auto-links dependencies. Verify setup with:

```bash
npx react-native info
```

**Note:** All required Android permissions are already configured in `AndroidManifest.xml`:
- Bluetooth permissions (BLE scanning and connection)
- Location permission (required for BLE)
- Storage permissions (for CSV logging)
- Foreground service permissions (for background operation)

## Development Workflow

### Running the App

**On Android Device/Emulator:**
```bash
npm run android
```

**On iOS Device/Simulator:**
```bash
npm run ios
```

### Debugging

- **Metro Bundler**: Starts automatically with `npm run android`
- **React Native Debugger**: Optional Chrome DevTools integration
- **Logcat**: `adb logcat` for native Android logs

### Building for Production

**Android:**
```bash
cd android
./gradlew assembleRelease
```

The APK will be at: `android/app/build/outputs/apk/release/app-release.apk`

## Project Structure

After initialization, your structure will be:

```
VertexBLE/
├── android/              # Native Android code
├── ios/                  # Native iOS code (future)
├── src/                  # React Native source
│   ├── components/       # Reusable components
│   ├── screens/          # Screen components
│   ├── services/         # BLE service, logging service
│   ├── utils/            # Helper functions
│   └── navigation/       # Navigation setup
├── App.tsx               # Main app component
└── package.json          # Dependencies
```

## Key Files to Create

### 1. BLE Service (`src/services/BleService.ts`)

Handle BLE connection, scanning, and data reception.

### 2. File Logging Service (`src/services/FileService.ts`)

Handle CSV file creation and logging.

### 3. Foreground Service (`src/services/LoggingService.ts`)

Android foreground service for background operation.

### 4. Main App Screen (`src/screens/HomeScreen.tsx`)

Device scanning and connection UI.

### 5. File List Screen (`src/screens/FileListScreen.tsx`)

Display and manage recorded CSV files.

## Troubleshooting

### Permission Errors

If you encounter permission errors:
```bash
sudo chown -R $(whoami) ~/.npm
```

### ADB Connection Issues

If device not detected:
```bash
adb kill-server
adb start-server
adb devices
```

### Metro Bundler Issues

Clear Metro cache:
```bash
npm start --reset-cache
```

### Gradle Build Issues

Clean and rebuild:
```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

## Next Steps

1. Create the React Native project following steps above
2. Implement BLE service for IMU device communication
3. Implement file logging functionality
4. Create UI screens (Home, File List)
5. Add foreground service for background operation
6. Test with physical device

## Resources

- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx)
- [React Navigation](https://reactnavigation.org/)
- [NativeWind](https://www.nativewind.dev/)

