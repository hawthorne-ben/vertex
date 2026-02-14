# Google Maps Setup for Android

The recording detail screen now includes a map visualization that displays GPS tracks from VTX recordings. To enable this feature, you need to configure a Google Maps API key.

## Setup Instructions

### 1. Get a Google Maps API Key

1. Go to the [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Maps SDK for Android** API:
   - Navigate to "APIs & Services" > "Library"
   - Search for "Maps SDK for Android"
   - Click "Enable"
4. Create an API key:
   - Navigate to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "API Key"
   - Copy the generated API key

### 2. Configure the API Key

**Option A: Direct Configuration (Development)**

Open `android/app/src/main/AndroidManifest.xml` and replace `YOUR_GOOGLE_MAPS_API_KEY` with your actual API key:

```xml
<meta-data
  android:name="com.google.android.geo.API_KEY"
  android:value="AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"/>
```

**Option B: Environment Variable (Recommended for Production)**

1. Add your API key to `.env.local`:
   ```
   GOOGLE_MAPS_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

2. Update `AndroidManifest.xml` to read from environment:
   ```xml
   <meta-data
     android:name="com.google.android.geo.API_KEY"
     android:value="${GOOGLE_MAPS_API_KEY}"/>
   ```

3. Configure Gradle to inject the environment variable (if not already set up).

### 3. Restrict the API Key (Recommended)

For security, restrict your API key in the Google Cloud Console:

1. Go to "APIs & Services" > "Credentials"
2. Click on your API key
3. Under "Application restrictions":
   - Select "Android apps"
   - Click "Add an item"
   - Enter your package name: `com.vertex.android`
   - Get your SHA-1 fingerprint:
     ```bash
     cd android
     ./gradlew signingReport
     ```
   - Copy the SHA-1 from the debug variant and add it

### 4. Verify Setup

1. Clean and rebuild the app:
   ```bash
   npm run android
   ```

2. Record a ride with GPS or load an existing VTX file with GPS data
3. Open the recording detail screen
4. You should see a map at the top with your GPS track (or centered on San Francisco if no GPS data)

## Features

### Map Display

- **With GPS Data**: Map shows the recorded GPS track as a blue polyline, automatically zoomed to fit the entire route
- **Without GPS Data**: Map centers on San Francisco (Golden Gate Bridge area) at a default zoom level

### Map Configuration

- 40% of screen height
- No user location dot (shows recorded track only)
- Compass and toolbar disabled for cleaner interface
- Navigation header overlayed on map (transparent background)

## Troubleshooting

### Map shows blank white screen
- Verify API key is correct in AndroidManifest.xml
- Check that "Maps SDK for Android" is enabled in Google Cloud Console
- Check logcat for authentication errors: `adb logcat | grep -i "maps"`

### Map shows "For development purposes only" watermark
- Your API key is unrestricted (ok for development)
- Add billing account in Google Cloud Console for production use

### App crashes on map screen
- Ensure Google Play Services is installed on device/emulator
- Check that `play-services-maps` dependency is added in build.gradle
- Verify minimum SDK version is 24+ (Android 7.0+)

## Cost Considerations

Google Maps API usage is free up to certain limits:
- **Free tier**: 28,000 map loads per month
- **Map SDK for Android**: $7 per 1,000 loads after free tier
- For typical personal use (viewing recordings), you'll stay well within free tier

Monitor usage at: https://console.cloud.google.com/apis/dashboard

## Alternative: OpenStreetMap

If you prefer not to use Google Maps, the map can be switched to use OpenStreetMap (via react-native-maps with PROVIDER_OSM), which requires no API key but has different styling and performance characteristics.

## References

- [Google Maps Platform Documentation](https://developers.google.com/maps/documentation/android-sdk)
- [react-native-maps Documentation](https://github.com/react-native-maps/react-native-maps)
- [Google Cloud Console](https://console.cloud.google.com/)
