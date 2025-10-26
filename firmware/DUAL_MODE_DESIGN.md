# Dual-Mode Firmware Design

## Overview

Two operating modes optimized for different use cases:
- **Charging Mode**: WiFi + web UI + NTP sync (when plugged in)
- **Logging Mode**: Offline SD card logging (when on battery)

## Mode Detection

### Charging Detection
```cpp
bool isCharging() {
  // Read USB detection pin or battery voltage
  // Feather ESP32 V2 has battery voltage monitoring on A13
  float voltage = analogRead(A13) * 2 * 3.3 / 4096.0;
  return (voltage > 4.2);  // USB voltage present
}
```

**Alternative**: GPIO pin that detects USB connection (check Feather docs)

## Operating Modes

### Mode 1: Charging (WiFi + Web Dashboard)

**When**: USB power detected (voltage > 4.2V)

**Features**:
- Connect to WiFi
- Sync time via NTP
- Serve web dashboard
- Display battery status
- Show calibration status
- **Do NOT log to SD card** (saves writes, reduces heat)

**Power**: High (WiFi + sensor sampling)
**UI**: Full web dashboard

### Mode 2: Logging (Offline + SD Card)

**When**: Battery power only (voltage < 4.2V)

**Features**:
- Turn OFF WiFi (major power savings)
- Check sensor calibration status
- If calibrated (System = 3): Start logging to SD card
- If not calibrated: Blink LED or skip logging
- High-rate sampling (50-100Hz)
- File rotation every 30 minutes
- Periodic flush for data integrity

**Power**: Low (sensor + SD card only, no WiFi)
**UI**: None (offline)

## Implementation Architecture

### Mode Selection (Startup)
```cpp
void setup() {
  // Initialize sensor
  bno.begin();
  
  // Determine mode
  if (isCharging()) {
    mode = MODE_CHARGING;
    initializeChargingMode();
  } else {
    mode = MODE_LOGGING;
    initializeLoggingMode();
  }
}
```

### Charging Mode (WiFi + Web)
```cpp
void initializeChargingMode() {
  // Set LED to blue (connecting)
  setLed(0, 0, 255); // Blue
  
  // Connect to WiFi
  connectToWiFi();
  
  // Set LED to green (connected)
  setLed(0, 255, 0); // Green
  
  // Sync time via NTP
  setLed(255, 165, 0); // Orange
  syncTimeWithNTP();
  setLed(0, 255, 0); // Back to green
  
  // Start web server
  startWebServer();
  
  // DO NOT read sensor continuously in charging mode
  // Only read when web request comes in
  // Check calibration status periodically (every 5 seconds)
  sensorReadInterval = 5000; // 5 seconds
}

void loopChargingMode() {
  // Handle web requests
  server.handleClient();
  
  // Periodically check calibration status (not full sensor read)
  static unsigned long lastCheck = 0;
  if (millis() - lastCheck > sensorReadInterval) {
    checkCalibrationStatus();
    lastCheck = millis();
  }
  
  // Update LED based on calibration status
  updateCalibrationLED();
  
  // Monitor battery charging status
  monitorCharging();
}
```

### Logging Mode (Offline + SD)
```cpp
void initializeLoggingMode() {
  // Turn off WiFi completely to save power
  WiFi.disconnect(true);  // Disconnect and turn off WiFi
  WiFi.mode(WIFI_OFF);
  
  // Turn off Bluetooth
  btStop();
  
  // Check calibration
  uint8_t sys, gyro, accel, mag;
  bno.getCalibration(&sys, &gyro, &accel, &mag);
  
  // Set LED based on calibration status
  if (sys == 3) {
    setLedBreathing(0, 255, 0); // Green breathing = fully calibrated
  } else if (sys >= 1 && sys <= 2) {
    setLedBlink(255, 255, 0, 500); // Yellow blink = partial
  } else {
    setLedBlink(255, 0, 0, 250); // Red fast blink = not calibrated
    // Still proceed with logging, but warn user
  }
  
  // Initialize SD card
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("[ERROR] SD card failed");
    return;
  }
  
  // Create log file with NTP-synced time (from previous sync)
  // Or use millis() if NTP never synced
  createLogFile();
  
  // Sample at high rate
  samplingRate = 20; // 50Hz
}

void loopLoggingMode() {
  // Read sensor at high rate
  updateSensorData();
  
  // Log to SD card
  logToSD();
  
  // Check for file rotation (every 30 min)
  if (shouldRotateFile()) {
    setLedDoubleBlink(0, 0, 255); // Blue double blink
    rotateFile();
    setLedBreathing(0, 255, 0); // Back to green breathing
  }
  
  // Check for periodic flush (every 5 sec)
  if (shouldFlush()) {
    flushBuffer();
  }
  
  // Update LED breathing pattern
  updateBreathingLED();
}
```

## NeoPixel LED Implementation

### LED Helper Functions

```cpp
#include <Adafruit_NeoPixel.h>

#define LED_PIN 8  // Feather ESP32 V2 NeoPixel pin
Adafruit_NeoPixel pixel(1, LED_PIN, NEO_GRB + NEO_KHZ800);

void initLED() {
  pixel.begin();
  pixel.setBrightness(20);  // Low brightness to save power
}

void setLed(uint8_t r, uint8_t g, uint8_t b) {
  pixel.setPixelColor(0, pixel.Color(r, g, b));
  pixel.show();
}

void setLedBlink(uint8_t r, uint8_t g, uint8_t b, int interval) {
  static unsigned long lastBlink = 0;
  static bool state = false;
  
  if (millis() - lastBlink > interval) {
    state = !state;
    if (state) {
      pixel.setPixelColor(0, pixel.Color(r, g, b));
    } else {
      pixel.setPixelColor(0, pixel.Color(0, 0, 0));
    }
    pixel.show();
    lastBlink = millis();
  }
}

void setLedDoubleBlink(uint8_t r, uint8_t g, uint8_t b) {
  static unsigned long lastBlink = 0;
  static int blinkCount = 0;
  
  unsigned long now = millis();
  if (now - lastBlink > 100) {  // 100ms per blink
    blinkCount++;
    if (blinkCount == 1 || blinkCount == 2) {
      pixel.setPixelColor(0, pixel.Color(r, g, b));
    } else if (blinkCount == 3 || blinkCount == 4) {
      pixel.setPixelColor(0, pixel.Color(0, 0, 0));
    } else if (blinkCount >= 8) {
      blinkCount = 0;  // Reset for double blink
    }
    pixel.show();
    lastBlink = now;
  }
}

void setLedBreathing(uint8_t r, uint8_t g, uint8_t b) {
  static float brightness = 0;
  static bool fading = false;
  
  // Breathing effect: fade in/out
  if (fading) {
    brightness -= 2;
    if (brightness <= 0) fading = false;
  } else {
    brightness += 2;
    if (brightness >= 100) fading = true;
  }
  
  uint8_t r_scaled = (r * brightness) / 100;
  uint8_t g_scaled = (g * brightness) / 100;
  uint8_t b_scaled = (b * brightness) / 100;
  
  pixel.setPixelColor(0, pixel.Color(r_scaled, g_scaled, b_scaled));
  pixel.show();
}
```

## NTP Time Sync

### Why NTP Instead of RTC

**Advantages**:
- ✅ No additional hardware (RTC module)
- ✅ Already have WiFi connection
- ✅ Time synced to internet standard
- ✅ No drift or battery backup issues

**Disadvantages**:
- ❌ Requires WiFi (only in charging mode)
- ❌ Need to store time for offline logging

### NTP Implementation

```cpp
#include <time.h>

void syncTimeWithNTP() {
  const char* ntpServer = "pool.ntp.org";
  const long gmtOffset_sec = -28800;  // PST offset
  const int daylightOffset_sec = 3600;
  
  configTime(gmtOffset_sec, daylightOffset_sec, ntpServer);
  
  // Wait for sync
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    Serial.println("[ERROR] NTP sync failed");
    return;
  }
  
  Serial.println("[OK] NTP synced");
  printTime(&timeinfo);
  
  // Store current time for offline use
  lastSyncTime = time(NULL);
  lastSyncMillis = millis();
}

unsigned long getCurrentUnixTime() {
  if (isCharging()) {
    // Use real-time from NTP
    return time(NULL);
  } else {
    // Calculate from last sync time
    unsigned long elapsedMillis = millis() - lastSyncMillis;
    return lastSyncTime + (elapsedMillis / 1000);
  }
}
```

## Mode Transitions

### Charging → Logging Transition
- USB disconnected
- Detect voltage drop
- Save any pending data
- Turn off WiFi
- Create new log file
- Start high-rate logging

### Logging → Charging Transition
- USB connected
- Detect voltage increase
- Flush current log file
- Close SD card
- Turn on WiFi
- Connect to network
- Start web server

## Data Flow

### Charging Mode Data Flow
```
BNO055 Sensor → WiFi → Web Dashboard → Browser
                ↓
              NTP Sync
```

### Logging Mode Data Flow
```
BNO055 Sensor → SD Card → CSV File
```

## Power Management

### Power Optimization Features

**Charging Mode Optimizations**:
- ✅ Sensor only read on-demand (web request)
- ✅ Calibration checked every 5 seconds (not full sensor read)
- ✅ No continuous sensor sampling
- ✅ WiFi ON (required for web UI)

**Logging Mode Optimizations**:
- ✅ WiFi OFF completely (major power savings)
- ✅ Bluetooth OFF completely
- ✅ Sensor read at 50Hz (high rate for logging)
- ✅ SD card write buffering (reduces power spikes)

### Power Consumption

| Mode | WiFi | BT | Sensor | SD Card | Web Server | Current |
|------|-----|----|---------|---------|------------|---------|
| **Charging** | ON | ON | Minimal* | OFF | ON | 50-80mA |
| **Logging** | OFF | OFF | 50Hz | ON | OFF | 25-40mA |

*Sensor read only on-demand for web UI, not continuously

**Battery Life Estimate** (assuming 1000mAh battery):
- Charging mode: 12-20 hours (optimized)
- Logging mode: 25-40 hours (with all radios off)

### Power Savings Breakdown

**Logging Mode Power Reduction**:
- WiFi OFF: -100mA
- Bluetooth OFF: -10mA  
- No web server: -20mA
- Sensor sampling only: -15mA (optimized from full read)
- **Total savings**: ~145mA (from 150mA → 40mA)

**Charging Mode Power Optimization**:
- Sensor read on-demand only: -20mA
- No continuous sampling: -10mA
- **Total optimization**: ~30mA savings

## File Naming Convention

### Logging Mode
```
ride_YYYYMMDD_HHMMSS.csv

Example: ride_20251025_143022.csv
```

Timestamp from:
1. Last NTP sync (if available)
2. Or millis() offset from boot

## Calibration Strategy

### Charging Mode
- Display current calibration status
- Recommend calibration if needed
- Calibrate once before riding

### Logging Mode
- Check calibration at startup
- Warn if not calibrated (LED blink)
- Log anyway (with status flags)
- Post-processing can filter bad data

## NeoPixel LED Status Indicators

The Feather ESP32 V2 has a built-in NeoPixel RGB LED that can display status information.

### LED Color Legend

#### Charging Mode (USB Power)
| Color | Pattern | Meaning |
|-------|---------|---------|
| 🔵 **Blue** | Solid | WiFi connecting... |
| 🟢 **Green** | Solid | WiFi connected, ready |
| 🟡 **Yellow** | Solid | Calibration in progress |
| ⚪ **White** | Solid | Fully calibrated & ready |
| 🔴 **Red** | Slow blink | WiFi connection failed |
| 🟠 **Orange** | Fast blink | NTP sync in progress |

#### Logging Mode (Battery Power)
| Color | Pattern | Meaning |
|-------|---------|---------|
| 🟢 **Green** | Breathing (fade in/out) | Logging active (calibrated) |
| 🟡 **Yellow** | Blink (1/sec) | Logging with warning (partially calibrated) |
| 🔴 **Red** | Fast blink (2/sec) | Sensor not calibrated - no logging |
| 🔵 **Blue** | Double blink (every 2 sec) | File rotation in progress |
| ⚪ **White** | Brief flash | Low battery warning |
| ❌ **Off** | - | Power off / sleep |

### Status Priority (Highest to Lowest)
1. 🔴 Error conditions (calibration fail, WiFi fail)
2. 🟠 Time-critical operations (NTP sync)
3. 🟡 Warnings (partial calibration, file rotation)
4. 🟢 Normal operation (logging, connected)
5. ⚪ Information (ready state, battery low)

## User Experience

### On Charging
1. Plug in USB → 🔵 Blue solid (WiFi connecting...)
2. Device connects to WiFi → 🟢 Green solid (Connected)
3. Syncs NTP time → 🟠 Orange blink while syncing
4. Web dashboard available
5. Sensor calibration:
   - User moves sensor → 🟡 Yellow blink during movement
   - Full calibration achieved → ⚪ White solid (Ready)
6. Display on web UI: battery status, calibration, current sensor data

### On Riding (Offline)
1. Unplug from USB
2. WiFi turns off automatically
3. Check calibration status:
   - ✅ System = 3: 🟢 Green breathing → Starts logging
   - ⚠️ System = 1-2: 🟡 Yellow blink → Starts logging with warning
   - ❌ System = 0: 🔴 Red fast blink → Error, no logging
4. During logging:
   - 🟢 Green breathing (normal)
   - 🔵 Blue double blink (every 30 min during file rotation)
5. Mount on bike and ride
6. Data logs to SD card at 50Hz

### On Return (Charging)
1. Plug back in
2. LED shows 🔵 Blue → 🟢 Green (WiFi connecting)
3. Device reconnects to WiFi
4. Syncs time via NTP → 🟠 Orange blink
5. Green solid → Web dashboard available
6. Remove SD card to download data

### Error States
- 🔴 Red slow blink: WiFi failed to connect
- 🔴 Red fast blink: Sensor not calibrated (can't log)
- ⚪ White flash: Low battery (if monitoring implemented)

## Implementation Priority

### Phase 1: Basic Dual Mode
1. ✅ Charging detection
2. ✅ Mode selection
3. ✅ WiFi mode (use existing code)
4. ✅ Basic logging mode (SD card)
5. ⚠️ NTP sync (new)

### Phase 2: Robust Logging
1. File rotation
2. Periodic flush
3. Calibration checking
4. Error handling

### Phase 3: User Experience
1. LED status indicators
2. Better mode transitions
3. Web UI for charging status
4. Battery monitoring

## Code Structure

```
firmware/
├── bno055_logger.ino      // Main dual-mode firmware
├── modes/
│   ├── charging_mode.ino  // WiFi + web UI
│   └── logging_mode.ino   // SD card logging
├── utils/
│   ├── power_management.cpp
│   ├── ntp_sync.cpp
│   └── file_manager.cpp
└── DUAL_MODE_DESIGN.md    // This file
```

## Benefits of This Approach

✅ **No RTC hardware needed** - Use NTP during WiFi
✅ **Better power efficiency** - WiFi off when logging
✅ **Flexible** - Web UI for setup/monitoring
✅ **Simple** - One firmware, auto-detects mode
✅ **Cost effective** - No RTC module purchase needed
✅ **Accurate time** - NTP provides internet time
✅ **Offline capable** - Works without WiFi after sync

## Trade-offs

| Approach | RTC Module | NTP + WiFi |
|----------|------------|------------|
| Hardware cost | +$5 for DS3231 | $0 (has WiFi) |
| Setup complexity | Simple | Moderate |
| Time accuracy | Good (drift) | Excellent |
| Power consumption | Very low | Low (WiFi off when logging) |
| Offline logging | ✅ Always works | ✅ Needs one sync |

## Recommendation

**Use NTP + WiFi approach** for your use case because:
1. No additional hardware cost
2. You already have WiFi working
3. Excellent time accuracy
4. Mode detection is straightforward
5. Lower power when logging (WiFi off)
6. Can still check if NTP never synced (fallback to millis())

The only downside is needing one WiFi connection to sync time, but since you're charging via USB anyway, this is a perfect time to sync.
