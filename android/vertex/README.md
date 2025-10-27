# Vertex Android Companion App

This is the React Native Android companion app for the Vertex IMU cycling device.

## Current Status

✅ **Completed:**
- Android SDK setup and environment configuration
- React Native project initialized
- Required dependencies installed (BLE, file system, navigation)
- Android permissions configured in AndroidManifest.xml
- Basic project structure created
- Service stubs created (BleService, FileService)
- Data parser utility created
- HomeScreen UI scaffolded

⚠️ **TODO Before Running:**
1. Configure BLE Service and Characteristic UUIDs (from firmware)
2. Implement data parsing integration with BLE service
3. Implement background foreground service for logging
4. Add file list/export functionality
5. Test on physical device

## Getting Started

### 1. Configure BLE UUIDs

The BLE service UUIDs need to be configured based on your ESP32 firmware. Edit `src/services/BleService.ts`:

```typescript
private serviceUUID: string = 'YOUR_SERVICE_UUID'; // Replace with actual UUID
private characteristicUUID: string = 'YOUR_CHARACTERISTIC_UUID'; // Replace with actual UUID
```

### 2. Run the App

**Connect an Android device:**

```bash
# Check device connection
adb devices

# Run the app
npm run android
```

**Or use an emulator:**

```bash
# Install emulator system image (if not done)
sdkmanager "system-images;android-34;google_apis;x86_64"

# Create AVD
avdmanager create avd -n Vertex_Emulator -k "system-images;android-34;google_apis;x86_64"

# Start emulator
emulator -avd Vertex_Emulator

# In another terminal, run the app
npm run android
```

### 3. Development Workflow

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

## Project Structure

```
vertex/
├── src/
│   ├── components/      # Reusable UI components
│   ├── screens/         # Screen components
│   │   └── HomeScreen.tsx   # Main BLE interface
│   ├── services/        # Business logic services
│   │   ├── BleService.ts    # BLE communication
│   │   └── FileService.ts   # CSV file logging
│   ├── utils/           # Helper functions
│   │   └── dataParser.ts    # Parse IMU sensor data
│   ├── types/           # TypeScript type definitions
│   │   └── index.ts
│   └── navigation/      # Navigation configuration (future)
├── android/            # Native Android code
├── ios/                 # Native iOS code (future)
├── App.tsx              # Main app entry point
└── package.json         # Dependencies
```

## Key Features to Implement

### 1. BLE Device Scanning ✅ (Basic implementation)
- Scan for nearby BLE devices
- Display device list
- Connect to selected device

### 2. Connection Management ✅ (Basic implementation)
- Connect/disconnect to devices
- Handle connection errors
- Display connection status

### 3. Data Reception (Partial)
- BLE service and data parser stubs created
- Need to integrate subscription logic
- Need to implement data flow from BLE → Parser → File

### 4. File Logging (Partial)
- FileService created with CSV creation/logging
- Need to integrate with BLE data reception
- Need to implement start/stop session logic

### 5. Background Operation (TODO)
- Implement foreground service for background operation
- Add persistent notification
- Ensure BLE connection persists in background

### 6. File Management (TODO)
- Create file list screen
- Add file export/share functionality
- Add file deletion functionality

## Next Steps

1. **Get BLE UUIDs from firmware team**
   - Service UUID
   - Characteristic UUID for IMU data

2. **Implement data flow**
   - Connect BLE data reception to parser
   - Connect parsed data to file writer
   - Implement session start/stop

3. **Add foreground service**
   - Create LoggingService for background operation
   - Add notification
   - Test background persistence

4. **Create file list screen**
   - Navigation stack setup
   - File list UI
   - Share/export functionality

5. **Testing**
   - Test on physical Android device
   - Test with real ESP32 IMU device
   - Verify data logging and CSV format

## Dependencies

- `react-native-ble-plx` - BLE communication
- `react-native-background-actions` - Background service
- `react-native-fs` - File system operations
- `react-native-safe-area-context` - Safe area handling
- `@react-navigation/native` - Navigation
- `zustand` - State management (optional, can use Context)

## Known Issues & Patches

### react-native-ble-plx Android Crash Fix

The project includes a critical patch for `react-native-ble-plx@3.5.0` to fix Android crashes caused by null error codes in promise rejections.

**Issue:** The library's native Android code passes `null` as the error code parameter when rejecting promises, which crashes React Native's bridge with:
```
java.lang.NullPointerException: Parameter specified as non-null is null:
method com.facebook.react.bridge.PromiseImpl.reject, parameter code
```

**Fix Applied:** All 17 instances of `safePromise.reject(null, ...)` in `BlePlxModule.java` have been patched to use `safePromise.reject(error.errorCode.name(), ...)`.

**Maintenance:**
- The patch is automatically applied via `patch-package` during `npm install`
- Patch file location: `patches/react-native-ble-plx+3.5.0.patch`
- If upgrading the library, the patch may need to be regenerated:
  ```bash
  # After making changes to node_modules/react-native-ble-plx
  npx patch-package react-native-ble-plx
  ```

**Related Issues:**
- [react-native-ble-plx #1303](https://github.com/dotintent/react-native-ble-plx/issues/1303)

## Resources

- [React Native BLE Documentation](https://github.com/dotintent/react-native-ble-plx)
- [React Native File System](https://github.com/itinance/react-native-fs)
- [Android Foreground Services](https://developer.android.com/guide/components/foreground-services)
