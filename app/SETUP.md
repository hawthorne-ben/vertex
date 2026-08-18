# Android App Development Setup

Setup guide for the Vertex React Native companion app.

## Prerequisites

- **Node.js** 18+
- **Android SDK** (via Android Studio or command line tools), with `ANDROID_HOME` set
- **Android device or emulator**

Verify the SDK is on your path:

```bash
echo $ANDROID_HOME
sdkmanager --version
```

### Connect a Device

**Physical device** — enable Developer Options and USB Debugging on the phone, connect over USB, then confirm:

```bash
adb devices
```

**Emulator** — install a system image and create an AVD:

```bash
sdkmanager "system-images;android-34;google_apis;x86_64"
avdmanager create avd -n Pixel_8_API_34 -k "system-images;android-34;google_apis;x86_64"
emulator -avd Pixel_8_API_34
```

## Install

From the monorepo root:

```bash
pnpm install
```

Environment variables are configured separately — see [ENV_SETUP.md](./ENV_SETUP.md).

## Development Workflow

### Running the App

```bash
cd app
pnpm android
```

Metro bundler starts automatically. Native Android permissions (BLE scanning and
connection, location, storage, foreground service) are already declared in
`AndroidManifest.xml`.

### Debugging

- **Logcat** — `adb logcat` for native Android logs
- **Metro** — restart with a clean cache via `pnpm start --reset-cache`

### Building for Production

```bash
cd app/android
./gradlew assembleRelease
```

The APK lands at `app/android/app/build/outputs/apk/release/app-release.apk`.

## Troubleshooting

### ADB Connection Issues

If the device isn't detected:

```bash
adb kill-server
adb start-server
adb devices
```

### Gradle Build Issues

Clean and rebuild:

```bash
cd app/android
./gradlew clean
./gradlew assembleDebug
```

## Resources

- [React Native Documentation](https://reactnative.dev/docs/getting-started)
- [react-native-ble-plx](https://github.com/dotintent/react-native-ble-plx)
- [React Navigation](https://reactnavigation.org/)
