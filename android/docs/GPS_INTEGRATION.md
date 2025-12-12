# GPS Integration for Vertex Android App

**Goal:** Add GPS logging to record ride tracks synchronized with IMU data for visualization and sensor fusion.

**Use Cases:**
1. Visualize ride track overlaid with IMU data in recording detail view
2. GPS-based yaw correction for orientation fusion
3. Speed validation and ground truth for analysis
4. Geofencing and route mapping

---

## Table of Contents

1. [Android GPS Options](#android-gps-options)
2. [VTX Binary Format Extension](#vtx-binary-format-extension)
3. [Recording Service Integration](#recording-service-integration)
4. [Visualization Options](#visualization-options)
5. [GPS/IMU Fusion Considerations](#gpsimu-fusion-considerations)
6. [Implementation Roadmap](#implementation-roadmap)

---

## 1. Android GPS Options

### Option A: Android Location Services (Raw GPS)

**API:** `android.location.LocationManager`

**Pros:**
- Direct access to GPS hardware
- Fine-grained control over provider (GPS, Network, Fused)
- Access to raw NMEA sentences (if needed)
- No Google Play Services dependency

**Cons:**
- More boilerplate code
- Battery management is manual
- Less intelligent filtering

**Sample Rate:** 1-10 Hz typical (configurable)

**Code Example:**
```kotlin
val locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager

val locationListener = object : LocationListener {
    override fun onLocationChanged(location: Location) {
        // location.latitude, location.longitude, location.altitude
        // location.speed, location.bearing, location.accuracy
        // location.time (Unix milliseconds)
    }
}

// Request updates every 1 second or 5 meters
locationManager.requestLocationUpdates(
    LocationManager.GPS_PROVIDER,
    1000L, // minTime (ms)
    5f,    // minDistance (meters)
    locationListener
)
```

**Permissions Required:**
```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
```

---

### Option B: Google Play Services Fused Location Provider (Recommended)

**API:** `com.google.android.gms.location.FusedLocationProviderClient`

**Pros:**
- Intelligent sensor fusion (GPS + WiFi + Cell + sensors)
- Better battery efficiency
- Automatic fallback between providers
- Handles GPS signal loss gracefully
- Priority modes for different use cases

**Cons:**
- Requires Google Play Services
- Less control over raw GPS data
- Slightly abstracted from hardware

**Sample Rate:** 1-10 Hz typical (configurable via priority)

**Code Example:**
```kotlin
import com.google.android.gms.location.*

val fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

val locationRequest = LocationRequest.create().apply {
    interval = 1000L           // Update every 1 second
    fastestInterval = 500L     // Accept updates as fast as 0.5 seconds
    priority = LocationRequest.PRIORITY_HIGH_ACCURACY
    smallestDisplacement = 0f  // Report every location (no distance filter)
}

val locationCallback = object : LocationCallback() {
    override fun onLocationResult(locationResult: LocationResult) {
        locationResult.lastLocation?.let { location ->
            // location.latitude, location.longitude, location.altitude
            // location.speed, location.bearing, location.accuracy
            // location.time (Unix milliseconds)
        }
    }
}

fusedLocationClient.requestLocationUpdates(
    locationRequest,
    locationCallback,
    Looper.getMainLooper()
)
```

**Priority Modes:**
- `PRIORITY_HIGH_ACCURACY` - GPS only (~10m accuracy, high battery)
- `PRIORITY_BALANCED_POWER_ACCURACY` - GPS + WiFi (~100m accuracy, medium battery)
- `PRIORITY_LOW_POWER` - Cell/WiFi only (~1km accuracy, low battery)
- `PRIORITY_NO_POWER` - Passive (piggyback on other apps)

---

### Option C: React Native Geolocation API

**Library:** `@react-native-community/geolocation`

**Pros:**
- Cross-platform (iOS + Android)
- Simple JavaScript API
- Already integrated in many RN apps
- Permissions handled via RN modules

**Cons:**
- Lower update rate (typically 1-5 Hz max)
- Less control over Android-specific features
- May not integrate cleanly with native BLE recording service

**Sample Rate:** 1-5 Hz typical

**Code Example:**
```typescript
import Geolocation from '@react-native-community/geolocation';

Geolocation.watchPosition(
  (position) => {
    const { latitude, longitude, altitude, speed, heading, accuracy } = position.coords;
    const timestamp = position.timestamp; // Unix milliseconds
  },
  (error) => console.error(error),
  {
    enableHighAccuracy: true,
    distanceFilter: 0,
    interval: 1000,      // Android only
    fastestInterval: 500 // Android only
  }
);
```

---

### Recommendation: **Option B (Fused Location Provider)**

**Why:**
1. Best battery efficiency for continuous GPS logging
2. Handles GPS signal loss (tunnels, buildings) gracefully
3. Industry standard for fitness/cycling apps
4. Can still access raw GPS if needed via `setGranularity()`

**For cycling use case:**
- Priority: `PRIORITY_HIGH_ACCURACY` (need precise track)
- Update rate: 1 Hz (every second) - standard for cycling GPS
- Minimum displacement: 0 meters (log every update)

---

## 2. VTX Binary Format Extension

### Current VTX Format (v1.0)

**Header (64 bytes):**
```
magic: "VTX\0" (4 bytes)
versionMajor: uint8
versionMinor: uint8
metadataLength: uint16
dataOffset: uint32
recordCount: uint64
sampleRate: uint16 (Hz)
startTimestamp: uint64 (Unix ms)
endTimestamp: uint64 (Unix ms)
recordFormat: uint8 (flags)
compression: uint8
reserved: 32 bytes
```

**Record Format Flags:**
```
0x01: HAS_ACCEL
0x02: HAS_GYRO
0x04: HAS_MAG
0x08: HAS_QUAT
0x10: HAS_EULER
0x20: HAS_GPS      ← NEW
0x40: RESERVED
0x80: RESERVED
```

**Current Record Structure (28-44 bytes depending on flags):**
```
timestamp: uint32 (ms offset from header.startTimestamp)
accel: float32[3] (12 bytes) - if HAS_ACCEL
gyro: float32[3] (12 bytes) - if HAS_GYRO
mag: float32[3] (12 bytes) - if HAS_MAG
quat: float32[4] (16 bytes) - if HAS_QUAT
euler: float32[3] (12 bytes) - if HAS_EULER
```

---

### Proposed GPS Extension

#### Option 1: GPS in Main Record (Sparse)

**Problem:** GPS updates at 1 Hz, IMU at 20-25 Hz → 95% null GPS data

**Format:**
```
gps: if HAS_GPS flag set
  latitude: float64 (8 bytes)
  longitude: float64 (8 bytes)
  altitude: float32 (4 bytes)
  speed: float32 (4 bytes) - m/s
  bearing: float32 (4 bytes) - degrees
  accuracy: float16 (2 bytes) - meters
  total: 30 bytes
```

**Record size with GPS:** 28 (base) + 30 (GPS) = **58 bytes**

**Waste:**
- 20 Hz IMU × 30 min = 36,000 records
- Only 1,800 have GPS (1 Hz)
- 34,200 records × 30 bytes = **1.03 MB wasted**

**Verdict:** ❌ Inefficient for different sample rates

---

#### Option 2: Separate GPS Record Stream (Recommended)

**Add new record format flag:**
```
0x20: HAS_GPS_STREAM
```

**Header additions:**
```
gpsRecordCount: uint32 (4 bytes)
gpsDataOffset: uint32 (4 bytes)
reserved: reduce by 8 bytes to fit
```

**File structure:**
```
[Header 64 bytes]
[Metadata variable]
[IMU Records @ dataOffset] ← 20-25 Hz, 28-44 bytes each
[GPS Records @ gpsDataOffset] ← 1 Hz, 38 bytes each
```

**GPS Record Structure (38 bytes):**
```
timestamp: uint32 (4 bytes) - ms offset from header.startTimestamp
latitude: float64 (8 bytes) - degrees
longitude: float64 (8 bytes) - degrees
altitude: float32 (4 bytes) - meters MSL
speed: float32 (4 bytes) - m/s
bearing: float32 (4 bytes) - degrees (0-360, true north)
horizontalAccuracy: float32 (4 bytes) - meters
verticalAccuracy: float32 (4 bytes) - meters
```

**Advantages:**
- ✅ No wasted space (separate streams)
- ✅ Easy to seek/skip GPS if not needed
- ✅ Can have different sample rates
- ✅ Clean separation of concerns

**Example file sizes (30 min ride):**
- IMU: 36,000 records × 44 bytes = **1.58 MB**
- GPS: 1,800 records × 38 bytes = **68 KB**
- Total: **1.65 MB** (vs 2.1 MB with Option 1)

---

#### Option 3: External GPS Sidecar File

**Keep VTX as-is, add companion .gps file:**

```
ride_2025-01-15.vtx  (IMU data)
ride_2025-01-15.gps  (GPS data in simple CSV or binary)
```

**GPS file format (CSV example):**
```csv
timestamp_ms,latitude,longitude,altitude,speed,bearing,accuracy
1672531200000,37.8199,-122.4783,50.5,4.2,145.0,5.0
1672531201000,37.8200,-122.4782,50.8,4.3,146.0,5.0
```

**Advantages:**
- ✅ No VTX format changes needed
- ✅ Optional GPS (can record IMU without GPS)
- ✅ Easy to debug (human-readable CSV)

**Disadvantages:**
- ❌ Two files to manage/upload
- ❌ Synchronization issues if files separated
- ❌ More complex UI for file selection

**Verdict:** ⚠️ Simpler short-term, but messier long-term

---

### Recommendation: **Option 2 (Separate GPS Stream in VTX)**

**Rationale:**
1. Single file = simpler management
2. Atomic upload/download
3. Timestamp synchronization guaranteed
4. Efficient storage (no waste)
5. Easy to extend (can add more streams later: heart rate, power, etc.)

**VTX v1.1 Specification Changes:**

**Header (64 bytes) - modified:**
```c
struct VTXHeader {
    char magic[4];              // "VTX\0"
    uint8_t versionMajor;       // 1
    uint8_t versionMinor;       // 1 ← increment
    uint16_t metadataLength;
    uint32_t dataOffset;        // IMU data start
    uint64_t recordCount;       // IMU record count
    uint16_t sampleRate;
    uint64_t startTimestamp;
    uint64_t endTimestamp;
    uint8_t recordFormat;       // flags including 0x20 for HAS_GPS_STREAM
    uint8_t compression;
    uint32_t gpsRecordCount;    // NEW: number of GPS records
    uint32_t gpsDataOffset;     // NEW: GPS data start offset
    uint8_t reserved[24];       // Reduced from 32
};
```

**GPS Record (38 bytes):**
```c
struct GPSRecord {
    uint32_t timestamp;          // ms offset from header.startTimestamp
    double latitude;             // degrees
    double longitude;            // degrees
    float altitude;              // meters MSL
    float speed;                 // m/s
    float bearing;               // degrees (0-360, true north)
    float horizontalAccuracy;    // meters
    float verticalAccuracy;      // meters
};
```

---

## 3. Recording Service Integration

### Current RecordingService Architecture

```
RecordingService (Android Service)
    ├─ BLE Manager (receives IMU data from ESP32)
    ├─ VTX Stream Encoder (writes IMU to .vtx file)
    └─ File Manager (saves to storage)
```

### With GPS Integration

```
RecordingService (Android Service)
    ├─ BLE Manager (receives IMU data from ESP32 @ 20-25 Hz)
    ├─ GPS Manager (receives GPS from Android @ 1 Hz)
    ├─ VTX Stream Encoder (writes both streams to .vtx file)
    │   ├─ IMU buffer (write every 50-100ms)
    │   └─ GPS buffer (write every 1-5 seconds)
    └─ File Manager (saves to storage)
```

### Implementation Steps

**1. Add GPS Manager to RecordingService:**

```kotlin
// RecordingService.ts (add GPS management)

import com.google.android.gms.location.*

class RecordingService {
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var locationCallback: LocationCallback
    private val gpsBuffer = mutableListOf<GPSRecord>()

    fun startGPSLogging() {
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        val locationRequest = LocationRequest.create().apply {
            interval = 1000L          // 1 Hz
            fastestInterval = 1000L
            priority = LocationRequest.PRIORITY_HIGH_ACCURACY
            smallestDisplacement = 0f
        }

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { location ->
                    val gpsRecord = GPSRecord(
                        timestamp = location.time - recordingStartTime,
                        latitude = location.latitude,
                        longitude = location.longitude,
                        altitude = location.altitude.toFloat(),
                        speed = location.speed,
                        bearing = location.bearing,
                        horizontalAccuracy = location.accuracy,
                        verticalAccuracy = location.verticalAccuracyMeters?.toFloat() ?: 0f
                    )

                    gpsBuffer.add(gpsRecord)

                    // Write GPS buffer to file every 5 records (5 seconds)
                    if (gpsBuffer.size >= 5) {
                        flushGPSBuffer()
                    }
                }
            }
        }

        fusedLocationClient.requestLocationUpdates(
            locationRequest,
            locationCallback,
            Looper.getMainLooper()
        )
    }

    fun stopGPSLogging() {
        fusedLocationClient.removeLocationUpdates(locationCallback)
        flushGPSBuffer() // Write remaining GPS records
    }

    private fun flushGPSBuffer() {
        if (gpsBuffer.isEmpty()) return

        // Write GPS records to VTX file at gpsDataOffset
        vtxStreamEncoder.writeGPSRecords(gpsBuffer)
        gpsBuffer.clear()
    }
}
```

**2. Update VTX Stream Encoder:**

```kotlin
// VTXStreamEncoder.kt (add GPS stream support)

class VTXStreamEncoder {
    private var gpsRecordCount = 0
    private var gpsDataOffset = 0L

    fun initializeGPSStream() {
        // Reserve space after IMU data for GPS records
        // GPS records will be appended as they come in
        gpsDataOffset = getCurrentFileSize()
    }

    fun writeGPSRecords(records: List<GPSRecord>) {
        // Seek to GPS data section
        fileOutputStream.channel.position(gpsDataOffset)

        for (record in records) {
            // Write 38-byte GPS record
            writeUInt32(record.timestamp)
            writeFloat64(record.latitude)
            writeFloat64(record.longitude)
            writeFloat32(record.altitude)
            writeFloat32(record.speed)
            writeFloat32(record.bearing)
            writeFloat32(record.horizontalAccuracy)
            writeFloat32(record.verticalAccuracy)

            gpsRecordCount++
        }

        // Update GPS data offset for next write
        gpsDataOffset = fileOutputStream.channel.position()
    }

    fun finalizeFile() {
        // Update header with final GPS record count
        fileOutputStream.channel.position(48) // gpsRecordCount offset
        writeUInt32(gpsRecordCount)

        fileOutputStream.close()
    }
}
```

**3. Permissions and Battery Optimization:**

```xml
<!-- AndroidManifest.xml -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" /> <!-- Android 10+ -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" /> <!-- Android 14+ -->
```

**Request permissions at runtime:**
```kotlin
// Request location permissions before starting recording
ActivityCompat.requestPermissions(
    this,
    arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_BACKGROUND_LOCATION
    ),
    LOCATION_PERMISSION_REQUEST_CODE
)
```

---

## 4. Visualization Options

### Current Recording Detail Screen

```
DataDetailScreen
    ├─ File Info Card (filename, duration, sample rate)
    ├─ Data Type Selector (Orientation | Accel | Gyro)
    ├─ Statistics Cards (min/max/mean for X/Y/Z)
    └─ Line Chart (3 axes over time)
```

### With GPS: Add Map View

**Option A: Leaflet/React-Leaflet (Web approach)**

Already used in your web app - good for consistency.

```tsx
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet';

// In DataDetailScreen.tsx
const [gpsTrack, setGpsTrack] = useState<[number, number][]>([]);

// Load GPS from VTX file
const loadGPSTrack = async () => {
    const vtxData = await VTXFileService.readVTXFile(filePath);
    const gpsRecords = vtxData.gpsRecords; // NEW: read GPS stream

    const track = gpsRecords.map(record => [
        record.latitude,
        record.longitude
    ]);

    setGpsTrack(track);
};

// Render map
<MapContainer center={gpsTrack[0]} zoom={13} style={{ height: 400 }}>
    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
    <Polyline positions={gpsTrack} color="blue" />
</MapContainer>
```

**Cons:** Heavy for React Native (web-based maps)

---

**Option B: react-native-maps (Recommended)**

Native Google Maps (Android) / Apple Maps (iOS).

```bash
npm install react-native-maps
```

```tsx
import MapView, { Polyline, Marker } from 'react-native-maps';

// In DataDetailScreen.tsx
const [gpsTrack, setGpsTrack] = useState<{ latitude: number; longitude: number }[]>([]);
const [selectedPoint, setSelectedPoint] = useState<number | null>(null);

<MapView
    style={{ height: 300 }}
    initialRegion={{
        latitude: gpsTrack[0].latitude,
        longitude: gpsTrack[0].longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
    }}
>
    <Polyline
        coordinates={gpsTrack}
        strokeColor="#3b82f6"
        strokeWidth={4}
    />

    {selectedPoint !== null && (
        <Marker coordinate={gpsTrack[selectedPoint]} />
    )}
</MapView>
```

---

**Option C: Mapbox (Most Feature-Rich)**

Best for advanced features (heatmaps, 3D terrain, custom styling).

```bash
npm install @rnmapbox/maps
```

```tsx
import MapboxGL from '@rnmapbox/maps';

MapboxGL.setAccessToken('YOUR_MAPBOX_TOKEN');

<MapboxGL.MapView style={{ height: 300 }}>
    <MapboxGL.Camera
        centerCoordinate={[gpsTrack[0].longitude, gpsTrack[0].latitude]}
        zoomLevel={13}
    />

    <MapboxGL.ShapeSource
        id="routeSource"
        shape={{
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: gpsTrack.map(p => [p.longitude, p.latitude])
            }
        }}
    >
        <MapboxGL.LineLayer
            id="routeLine"
            style={{ lineColor: '#3b82f6', lineWidth: 4 }}
        />
    </MapboxGL.ShapeSource>
</MapboxGL.MapView>
```

---

### Recommendation: **react-native-maps**

**Why:**
- Native performance
- No API key required (uses Google Maps / Apple Maps)
- Good documentation and community support
- Simpler than Mapbox for basic use case

---

### Synchronized Visualization

**Goal:** Scrub through IMU chart and see position on map (and vice versa).

**Implementation:**

```tsx
// DataDetailScreen.tsx

const [selectedTimestamp, setSelectedTimestamp] = useState<number | null>(null);

// When user taps on IMU chart
const onChartPress = (timestamp: number) => {
    setSelectedTimestamp(timestamp);

    // Find closest GPS point
    const gpsIndex = gpsTrack.findIndex(gps => gps.timestamp >= timestamp);
    setSelectedGPSIndex(gpsIndex);
};

// Render map with marker at selected point
<MapView>
    <Polyline coordinates={gpsTrack} />

    {selectedGPSIndex !== null && (
        <Marker
            coordinate={gpsTrack[selectedGPSIndex]}
            pinColor="red"
        />
    )}
</MapView>

// Render IMU chart with vertical line at selected time
<LineChart data={imuData} onPress={onChartPress} />
```

---

### Color-Coded Track by IMU Data

**Example: Color track by roll angle (lean) or speed**

```tsx
// Segment track by roll angle
const trackSegments = gpsTrack.map((point, i) => {
    const imuSample = findClosestIMUSample(point.timestamp);
    const rollAngle = Math.abs(imuSample.roll);

    return {
        coordinates: [gpsTrack[i], gpsTrack[i + 1]],
        color: rollAngle > 20 ? '#ef4444' : // red (sharp turn)
               rollAngle > 10 ? '#f59e0b' : // orange (moderate)
               '#3b82f6'                     // blue (straight)
    };
});

// Render multiple polylines
{trackSegments.map((segment, i) => (
    <Polyline
        key={i}
        coordinates={segment.coordinates}
        strokeColor={segment.color}
        strokeWidth={4}
    />
))}
```

---

## 5. GPS/IMU Fusion Considerations

### Yaw Correction from GPS Bearing

**Problem:** IMU yaw drifts without magnetometer.

**Solution:** Fuse GPS bearing (course over ground) with IMU yaw.

**Complementary Filter Approach:**

```typescript
// Simple GPS/IMU yaw fusion
function fuseYaw(imuYaw: number, gpsBearing: number, gpsSpeed: number, alpha: number = 0.95): number {
    // Only use GPS bearing when moving (GPS bearing unreliable when stationary)
    if (gpsSpeed < 1.0) { // < 1 m/s (walking speed)
        return imuYaw; // Trust IMU only
    }

    // Complementary filter: high-pass IMU + low-pass GPS
    // IMU = short-term accuracy, GPS = long-term reference
    const fusedYaw = alpha * imuYaw + (1 - alpha) * gpsBearing;

    return normalizeAngle(fusedYaw);
}

function normalizeAngle(angle: number): number {
    while (angle > 180) angle -= 360;
    while (angle < -180) angle += 360;
    return angle;
}
```

**Kalman Filter (Advanced):**

For production-quality fusion, implement a Kalman filter:
- State: [yaw, yaw_rate, yaw_bias]
- Measurements: GPS bearing, IMU gyro Z
- Handles noise and uncertainty properly

Libraries:
- `@kalmanjs/kalmanjs` (JavaScript implementation)
- Or implement in native Kotlin for performance

---

### Altitude Correction from GPS

**Problem:** IMU altitude (from accel double integration) drifts badly.

**Solution:** Use GPS altitude as ground truth.

```typescript
// Reset IMU altitude to GPS periodically
function correctAltitude(imuAltitude: number, gpsAltitude: number, gpsAccuracy: number): number {
    // Only correct if GPS has good vertical accuracy
    if (gpsAccuracy < 10.0) { // < 10m vertical error
        return gpsAltitude;
    }

    // Otherwise trust IMU for short-term changes
    return imuAltitude;
}
```

---

### Speed Validation

**Compare IMU-derived speed with GPS speed:**

```typescript
// Detect IMU calibration issues
const imuSpeed = Math.sqrt(accel_x**2 + accel_y**2); // Simplified
const gpsSpeed = location.speed;

if (Math.abs(imuSpeed - gpsSpeed) > 2.0) { // > 2 m/s difference
    console.warn('IMU/GPS speed mismatch - possible calibration issue');
}
```

---

## 6. Implementation Roadmap

### Phase 1: Basic GPS Logging (Week 1)

**Goal:** Record GPS alongside IMU in VTX file.

**Tasks:**
1. ✅ Add Fused Location Provider to RecordingService
2. ✅ Request location permissions
3. ✅ Update VTX format to v1.1 (add GPS stream)
4. ✅ Implement GPS record buffering and writing
5. ✅ Test GPS logging during ride

**Deliverable:** VTX files with GPS stream

---

### Phase 2: Visualization (Week 2)

**Goal:** Display ride track on map in Recording Detail screen.

**Tasks:**
1. ✅ Install react-native-maps
2. ✅ Update VTXFileService to read GPS records
3. ✅ Add MapView to DataDetailScreen
4. ✅ Render GPS track as polyline
5. ✅ Add synchronized scrubbing (map ↔ IMU chart)

**Deliverable:** Map visualization in Android app

---

### Phase 3: GPS/IMU Fusion (Week 3-4)

**Goal:** Correct IMU yaw drift using GPS bearing.

**Tasks:**
1. ✅ Implement complementary filter for yaw fusion
2. ✅ Add speed-based GPS trust weighting
3. ✅ Export fused orientation data in VTX
4. ✅ Compare raw vs. fused yaw in visualization
5. ✅ Tune filter parameters (alpha)

**Deliverable:** Drift-corrected orientation data

---

### Phase 4: Advanced Features (Future)

**Nice-to-haves:**

1. **Color-coded track by IMU metrics**
   - Roll angle (lean)
   - Pitch (grade)
   - Speed
   - Vibration/roughness

2. **Geofencing for auto-start/stop**
   - Start recording when entering "cycling zone"
   - Stop when returning home

3. **Elevation profile from GPS + barometer**
   - Use GPS altitude + phone barometer
   - Plot elevation vs. distance

4. **Turn detection from GPS + IMU**
   - Validate IMU turns against GPS bearing changes
   - Count turns automatically

5. **Export to GPX/FIT for Strava compatibility**
   - Convert VTX → GPX for sharing
   - Include power/HR if available

---

## Appendices

### A. VTX v1.1 Full Specification

**File Structure:**
```
[Header: 64 bytes]
[Metadata: variable length JSON]
[IMU Records: recordCount × recordSize bytes]
[GPS Records: gpsRecordCount × 38 bytes]
```

**Header (64 bytes):**
```c
struct VTXHeader {
    char magic[4];              // "VTX\0"
    uint8_t versionMajor;       // 1
    uint8_t versionMinor;       // 1
    uint16_t metadataLength;
    uint32_t dataOffset;
    uint64_t recordCount;
    uint16_t sampleRate;
    uint64_t startTimestamp;
    uint64_t endTimestamp;
    uint8_t recordFormat;       // 0x20 = HAS_GPS_STREAM
    uint8_t compression;
    uint32_t gpsRecordCount;
    uint32_t gpsDataOffset;
    uint8_t reserved[24];
} __attribute__((packed));
```

**GPS Record (38 bytes):**
```c
struct GPSRecord {
    uint32_t timestamp;          // ms offset
    double latitude;             // degrees (-90 to +90)
    double longitude;            // degrees (-180 to +180)
    float altitude;              // meters MSL
    float speed;                 // m/s
    float bearing;               // degrees (0-360, true north)
    float horizontalAccuracy;    // meters
    float verticalAccuracy;      // meters
} __attribute__((packed));
```

---

### B. Permissions Handling

**Runtime Permission Request:**

```kotlin
// RecordScreen.tsx or RecordingService.kt

private fun requestLocationPermission() {
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
        != PackageManager.PERMISSION_GRANTED) {

        ActivityCompat.requestPermissions(
            this,
            arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ),
            LOCATION_PERMISSION_REQUEST_CODE
        )
    } else {
        startGPSLogging()
    }
}

override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<String>,
    grantResults: IntArray
) {
    when (requestCode) {
        LOCATION_PERMISSION_REQUEST_CODE -> {
            if (grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startGPSLogging()
            } else {
                // Show error: GPS required for tracking
                Toast.makeText(this,
                    "Location permission required for ride tracking",
                    Toast.LENGTH_LONG).show()
            }
        }
    }
}
```

---

### C. Battery Optimization Tips

**1. Batch GPS updates:**
```kotlin
// Instead of writing every GPS point immediately
val locationRequest = LocationRequest.create().apply {
    interval = 1000L
    maxWaitTime = 5000L // Batch up to 5 updates
}
```

**2. Disable GPS when not recording:**
```kotlin
// Stop GPS when recording stops
override fun onDestroy() {
    fusedLocationClient.removeLocationUpdates(locationCallback)
    super.onDestroy()
}
```

**3. Use passive mode when possible:**
```kotlin
// If another app is already using GPS, piggyback
priority = LocationRequest.PRIORITY_NO_POWER
```

---

### D. Testing Checklist

**GPS Integration Tests:**

- [ ] GPS permissions requested and granted
- [ ] GPS starts logging when recording starts
- [ ] GPS stops logging when recording stops
- [ ] GPS records written to VTX file correctly
- [ ] VTX file with GPS can be read back
- [ ] GPS track displays on map
- [ ] Map/chart synchronization works
- [ ] GPS works in poor signal areas (tunnels, buildings)
- [ ] Battery drain is acceptable (test 1 hour recording)
- [ ] File sizes are reasonable (~2 MB for 30 min ride)

---

### E. Useful Resources

**Android Location APIs:**
- https://developer.android.com/training/location
- https://developers.google.com/android/reference/com/google/android/gms/location/FusedLocationProviderClient

**React Native Maps:**
- https://github.com/react-native-maps/react-native-maps

**GPS/IMU Fusion:**
- "Principles of GNSS, Inertial, and Multisensor Integrated Navigation Systems" by Paul D. Groves
- https://github.com/rlabbe/Kalman-and-Bayesian-Filters-in-Python

**VTX Binary Format:**
- Current implementation: `/packages/vtx-parser/`
- Update encoder/decoder to support v1.1 GPS stream

---

## Summary

**Recommended Approach:**

1. **GPS Recording:** Use Google Play Services Fused Location Provider
2. **VTX Format:** Extend to v1.1 with separate GPS stream
3. **Visualization:** Use react-native-maps for native performance
4. **Fusion:** Implement complementary filter for yaw correction

**Expected Results:**
- GPS track overlaid with IMU data in recording detail view
- Yaw drift corrected using GPS bearing
- Validation of IMU features (bridge towers, turns) against GPS ground truth
- Foundation for advanced sensor fusion and route analysis

**Next Steps:**
1. Implement Phase 1 (GPS logging)
2. Test on bridge route with known ground truth
3. Iterate on visualization and fusion algorithms
