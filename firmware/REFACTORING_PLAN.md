# Firmware Refactoring Plan

**Date:** 2025-10-31
**Status:** Proposed
**Priority:** High - Technical debt has accumulated in monolithic structure

## Executive Summary

The current firmware (`sensor_notify.ino` - 584 lines) is functionally sound but architecturally weak. This document outlines a phased refactoring plan to modularize the codebase, improve maintainability, and reduce technical debt.

The `bno055_dual_mode_archive/` folder already demonstrates that modular architecture works (7 separate .cpp files, 736 total lines). This refactoring applies those lessons to the active production firmware.

## Current State Assessment

### Architecture Grade: C+ (Functional but needs refactoring)

**Strengths:**
- Functionally works correctly (B+)
- Good binary protocol for BLE efficiency
- Excellent performance monitoring
- Well-commented with clear intent

**Critical Weaknesses:**
- Monolithic structure - everything in one file (D)
- Low maintainability - hard to modify without breaking other parts (C-)
- Poor testability - cannot unit test individual components (F)
- Code duplication across firmware versions

### File Size Analysis

**sensor_notify.ino (Active Production):** 584 lines
```
Lines 1-43:    Header comments, defines, includes
Lines 44-103:  Global variables and structs (60 lines)
Lines 104-244: BLE callback classes (140 lines)
Lines 246-364: setup() function (119 lines - TOO LONG)
Lines 366-426: loop() function (61 lines)
Lines 428-494: sendSensorData() (67 lines)
Lines 496-556: updateSensorData() (61 lines)
Lines 558-583: reportPerformance() (26 lines)
```

**Industry best practice:** 200-300 lines per file maximum
**Current state:** Nearly 2x recommended size

## Anti-Patterns Identified

### 1. God Functions
- `setup()` is 119 lines - should be < 50 lines
- Violates Single Responsibility Principle
- Handles: Serial init, I2C init, sensor init, BLE device init, BLE server creation, BLE service creation, multiple BLE characteristics, advertising setup

**Impact:** Hard to test, debug, or reuse components

### 2. Excessive Debug Logging (55 occurrences)
```cpp
Serial.println("[CONFIG] Empty command received");
Serial.printf("[CONFIG] Command received: 0x%02X\n", cmd);
Serial.println("[ERROR] BNO055 not found. Check connections.");
```

**Problem:** Debug code mixed with production logic
**Impact:** Performance overhead, flash memory usage, no logging levels

### 3. Magic Numbers Without Constants
```cpp
// sensor_notify.ino:153
if (intervalMs >= 20 && intervalMs <= 1000) {
```

**Should be:**
```cpp
#define MIN_SAMPLE_INTERVAL_MS 20   // 50Hz max sampling rate
#define MAX_SAMPLE_INTERVAL_MS 1000 // 1Hz min sampling rate
if (intervalMs >= MIN_SAMPLE_INTERVAL_MS && intervalMs <= MAX_SAMPLE_INTERVAL_MS) {
```

### 4. Blocking Delays in Setup
- Line 248: `delay(1000);` - 1 second startup delay
- Line 260: `delay(10);` - Button stabilization
- Line 274: `delay(500);` - I2C stabilization after sleep
- Line 303: `delay(500);` - Post-sensor init delay

**Problem:** Blocks entire system, prevents other operations
**Impact:** Poor user experience, missed interrupts

### 5. Duplicated Buffer Packing Code (15 repetitive memcpy calls)
```cpp
memcpy(buffer + offset, &sensorData.timestamp, 4);
offset += 4;
memcpy(buffer + offset, &sensorData.roll, 4);
offset += 4;
// ... 12 more identical patterns
```

**Problem:** Repetitive code without abstraction
**Solution:** Helper function or struct packing macro

### 6. Global State Everywhere (20+ global variables)
```cpp
BLEServer* pServer = nullptr;
BLEService* pService = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
unsigned long connectionTime = 0;
SensorData sensorData;
// ... many more
```

**Problem:** No encapsulation, hard to test, potential race conditions

### 7. Dead/Commented Code
**bno055_dual_mode.ino:378-520** - 143 lines of non-functional LED control code

**Problem:** Dead code inflates file size, confuses readers
**Note:** README.md already states "Fixed I2C conflict by removing LED support"

## Code Duplication Across Files

### 1. I2C Initialization (3 occurrences)
- sensor_notify.ino:288-291
- bno055_dual_mode.ino:73-75
- Archive sensor_manager.cpp:16-18

**Solution:** Create `initI2C(uint32_t clockSpeed)` helper

### 2. Quaternion to Euler Conversion (2 occurrences with different constants!)
```cpp
// sensor_notify.ino:501-526
sensorData.yaw = euler.x() * 180.0 / M_PI;

// bno055_dual_mode.ino:334-349
sensorData.roll = euler.x() * 57.2958;
```

**Problem:** Different conversion constants (180/M_PI vs 57.2958)
**Solution:** Use named constant `RAD_TO_DEG`

### 3. Battery Voltage Reading (2 implementations)
```cpp
// sensor_notify.ino:552-554
int adcValue = analogRead(BATTERY_PIN);
sensorData.battery_voltage = (adcValue / 4095.0) * 3.3 * BATTERY_VOLTAGE_DIVIDER;

// bno055_dual_mode.ino:372-376
analogReadResolution(12);
int raw = analogRead(BATTERY_MONITOR_PIN);
return (raw / 4095.0) * 3.3 * 2;
```

**Issue:** First version doesn't set ADC resolution (may be incorrect)

## Recommended Module Structure

### Target Architecture (5 modules)

```
firmware/sensor_notify/
├── sensor_notify.cpp          (main - ~100 lines)
├── ble_manager.h/.cpp         (~150 lines)
├── sensor_manager.h/.cpp      (~80 lines)
├── power_manager.h/.cpp       (~80 lines)
├── performance.h/.cpp         (~60 lines)
└── config.h                   (all constants)
```

### Module Responsibilities

#### 1. sensor_notify.cpp (Main Coordinator)
**Lines:** ~100
**Responsibilities:**
- `setup()` - Initialize all managers
- `loop()` - Coordinate between modules
- High-level orchestration only

**Example:**
```cpp
#include <Arduino.h>
#include "ble_manager.h"
#include "sensor_manager.h"
#include "power_manager.h"
#include "performance.h"
#include "config.h"

BLEManager bleManager;
SensorManager sensorManager;
PowerManager powerManager;
PerformanceTracker performance;

void setup() {
  Serial.begin(115200);
  delay(1000);

  powerManager.init();
  sensorManager.init();
  bleManager.init();
  performance.init();

  Serial.println("[SETUP] Vertex IMU Device Ready");
}

void loop() {
  if (powerManager.shouldShutdown()) {
    powerManager.shutdown();
    return;
  }

  if (sensorManager.update()) {
    bleManager.sendData(sensorManager.getData());
    performance.recordSample();
  }

  powerManager.updateLED();
  performance.report();
}
```

#### 2. ble_manager.h/.cpp (BLE Communication)
**Lines:** ~150
**Responsibilities:**
- BLE device initialization
- BLE server/service/characteristic setup
- Connection callbacks
- Data transmission (`sendSensorData()`)
- Configuration command handling

**Public Interface:**
```cpp
class BLEManager {
public:
  void init();
  bool isConnected();
  void sendData(const SensorData& data);
  void setConnectedCallback(std::function<void(bool)> callback);

private:
  BLEServer* pServer;
  BLEService* pService;
  BLECharacteristic* pCharacteristic;
  bool deviceConnected;
  unsigned long connectionTime;
};
```

**Extracted from:**
- Lines 104-244: BLE callback classes
- Lines 246-310: BLE initialization in setup()
- Lines 428-494: sendSensorData() function

#### 3. sensor_manager.h/.cpp (BNO055 Sensor)
**Lines:** ~80
**Responsibilities:**
- BNO055 initialization
- Sensor data reading
- Quaternion to Euler conversion
- Calibration status

**Public Interface:**
```cpp
class SensorManager {
public:
  bool init();
  bool update();  // Returns true if new data available
  const SensorData& getData() const;
  bool isCalibrated() const;

private:
  Adafruit_BNO055 bno;
  SensorData sensorData;
  unsigned long lastSampleTime;
  uint32_t sampleIntervalMs;
};
```

**Extracted from:**
- Lines 288-303: Sensor initialization in setup()
- Lines 496-556: updateSensorData() function

#### 4. power_manager.h/.cpp (Power & Battery)
**Lines:** ~80
**Responsibilities:**
- Battery voltage monitoring
- Power button handling
- LED status indicator
- Sleep/shutdown management

**Public Interface:**
```cpp
class PowerManager {
public:
  void init();
  float getBatteryVoltage();
  bool shouldShutdown();
  void shutdown();
  void updateLED();

private:
  unsigned long lastBatteryRead;
  unsigned long lastLEDToggle;
  bool ledState;
};
```

**Extracted from:**
- Lines 246-264: Button/LED initialization in setup()
- Lines 370-388: Button checking in loop()
- Lines 403-411: LED blinking in loop()
- Lines 552-554: Battery reading in updateSensorData()

#### 5. performance.h/.cpp (Metrics Tracking)
**Lines:** ~60
**Responsibilities:**
- Sample rate tracking
- Loop timing analysis
- BLE transmission stats
- Performance reporting

**Public Interface:**
```cpp
class PerformanceTracker {
public:
  void init();
  void recordSample();
  void recordLoopStart();
  void recordLoopEnd();
  void report();

private:
  PerformanceMetrics metrics;
  unsigned long lastReportTime;
};
```

**Extracted from:**
- Lines 94-102: PerformanceMetrics struct
- Lines 414-418: Performance tracking in loop()
- Lines 558-583: reportPerformance() function

#### 6. config.h (All Constants)
**Lines:** ~50
**Responsibilities:**
- All #defines
- Pin assignments
- Default values
- Named constants for magic numbers

**Contents:**
```cpp
#ifndef CONFIG_H
#define CONFIG_H

// Hardware Pins
#define BUTTON_PIN 0
#define LED_PIN 13
#define BATTERY_PIN 35
#define BATTERY_VOLTAGE_DIVIDER 2.0

// Timing Constants
#define CONNECTION_STABILIZE_MS 1000
#define BATTERY_READ_INTERVAL_MS 1000
#define PERF_REPORT_INTERVAL_MS 5000
#define MIN_SAMPLE_INTERVAL_MS 20   // 50Hz max
#define MAX_SAMPLE_INTERVAL_MS 1000 // 1Hz min
#define DEFAULT_SAMPLE_INTERVAL_MS 100

// BLE Configuration
#define BLE_DEVICE_NAME "Vertex IMU"
#define SERVICE_UUID "12345678-1234-1234-1234-123456789012"
#define CHAR_UUID "87654321-4321-4321-4321-210987654321"
#define CONFIG_UUID "11111111-2222-3333-4444-555555555555"

// Conversion Constants
#define RAD_TO_DEG 57.29577951308232

#endif // CONFIG_H
```

## .ino vs .cpp Format

### Current: .ino files
**Pros:**
- Arduino IDE auto-includes Arduino.h
- Auto-generates forward declarations
- Simple for beginners

**Cons:**
- Poor IDE support (IntelliSense, refactoring)
- Non-standard C++ format
- Harder to integrate with professional tooling

### Recommended: .cpp files
**Changes Required:**
1. Add `#include <Arduino.h>` at top of each file
2. Add forward declarations for functions called before definition
3. Create proper header files with header guards
4. Rename .ino → .cpp

**Benefits:**
- Better IDE support
- Standard C++ format
- Easier unit testing
- Professional codebase

**Compatibility:** ESP32 Arduino framework supports both equally

## Phased Implementation Plan

### Phase 1: Immediate Cleanup (1-2 days)

**Goal:** Remove dead code and create foundation

1. **Delete Dead LED Code** (30 min)
   - Remove lines 378-520 from bno055_dual_mode.ino
   - 143 lines of non-functional code
   - **Impact:** Cleaner codebase, less confusion

2. **Create config.h** (1 hour)
   - Extract all #defines from sensor_notify.ino
   - Add named constants for magic numbers
   - Document each constant
   - **Impact:** Eliminates magic numbers anti-pattern

3. **Extract BLEManager** (3-4 hours)
   - Create ble_manager.h/.cpp
   - Move callback classes (lines 104-244)
   - Move sendSensorData() (lines 428-494)
   - Update main file to use BLEManager
   - **Impact:** Reduces main file by ~240 lines

4. **Test Phase 1 Changes** (1 hour)
   - Compile and upload firmware
   - Test BLE connectivity
   - Verify data transmission
   - **Validation:** All existing functionality works

**Deliverables:**
- Cleaner bno055_dual_mode.ino
- New config.h with all constants
- New ble_manager.h/.cpp module
- Updated sensor_notify.ino using BLEManager
- Test results document

### Phase 2: Core Modularization (1 week)

**Goal:** Complete the modular architecture

5. **Extract SensorManager** (3-4 hours)
   - Create sensor_manager.h/.cpp
   - Move BNO055 initialization
   - Move updateSensorData() function
   - **Impact:** Shared module for all firmware versions

6. **Extract PowerManager** (2-3 hours)
   - Create power_manager.h/.cpp
   - Move battery monitoring
   - Move button handling
   - Move LED control
   - **Impact:** Consolidates power-related logic

7. **Extract PerformanceTracker** (1-2 hours)
   - Create performance.h/.cpp
   - Move PerformanceMetrics struct
   - Move tracking and reporting functions
   - **Impact:** Clean separation of concerns

8. **Refactor main sensor_notify.cpp** (2-3 hours)
   - Simplify setup() to < 50 lines
   - Simplify loop() to coordination only
   - Remove all global variables except manager instances
   - **Impact:** Main file becomes ~100 lines

9. **Create Helper Functions** (2-3 hours)
   ```cpp
   void packFloat(uint8_t* buffer, int& offset, float value);
   void initI2C(uint32_t clockSpeed);
   CalibrationStatus readCalibration();
   ```
   - **Impact:** Eliminates code duplication

10. **Implement Logging Levels** (3-4 hours)
    ```cpp
    // Replace Serial.print with:
    LOG_ERROR("BNO055 not found");
    LOG_DEBUG("Calibration status: %d", sys);
    LOG_INFO("Device connected");
    ```
    - Create log_manager.h with macros
    - Compile-time logging level control
    - **Impact:** Clean production code, better debugging

11. **Test Phase 2 Changes** (2-3 hours)
    - Comprehensive functionality testing
    - Performance benchmarking
    - Memory usage analysis
    - **Validation:** No regressions, improved maintainability

**Deliverables:**
- 5 modular .cpp files
- Clean main coordinator (~100 lines)
- Helper function library
- Logging system
- Test results and benchmarks

### Phase 3: Professional Refinement (2 weeks)

**Goal:** Convert to professional C++ format

12. **Convert .ino to .cpp** (1-2 days)
    - Rename all .ino → .cpp
    - Add #include <Arduino.h>
    - Add forward declarations
    - Create proper header guards
    - **Impact:** Standard C++ format

13. **Create Comprehensive Headers** (1-2 days)
    - Document all public interfaces
    - Add Doxygen comments
    - Create usage examples
    - **Impact:** Better documentation

14. **Add Unit Tests** (3-4 days)
    - Test BLE packet packing/unpacking
    - Test battery voltage calculations
    - Test calibration thresholds
    - Test mode detection logic
    - **Impact:** Confidence in code correctness

15. **Fix Code Duplication** (2-3 days)
    - Consolidate I2C initialization
    - Standardize Euler conversion
    - Unify battery reading
    - **Impact:** DRY principle, consistency

16. **Test Phase 3 Changes** (1 day)
    - Full regression testing
    - Unit test suite execution
    - Integration testing
    - **Validation:** Professional-grade codebase

**Deliverables:**
- .cpp format firmware
- Comprehensive header documentation
- Unit test suite
- Updated build instructions
- Migration guide

### Phase 4: Advanced Features (1 month)

**Goal:** Add robustness and maintainability features

17. **Implement State Machine** (3-4 days)
    - Define explicit states: INIT, CONNECTING, CONNECTED, LOGGING, SLEEP
    - Replace implicit state (global variables) with enum
    - Add state transition validation
    - **Impact:** Predictable behavior, easier debugging

18. **Add Error Handling** (3-4 days)
    - Check return values from all functions
    - Implement retry logic for transient I2C errors
    - Add error recovery mechanisms
    - **Impact:** More robust firmware

19. **Performance Optimizations** (2-3 days)
    - Remove String concatenation (uses heap)
    - Use const char* for fixed strings
    - Pre-allocate buffers
    - **Impact:** Lower memory usage, faster execution

20. **Add OTA Update Support** (5-7 days)
    - Implement WiFi-based firmware updates
    - Add version checking
    - Create update verification
    - **Impact:** Field updateable firmware

21. **Generate Documentation** (2-3 days)
    - Set up Doxygen
    - Generate API documentation
    - Create architecture diagrams
    - **Impact:** Maintainable by others

22. **Final Testing** (3-5 days)
    - Full system integration testing
    - Long-term stability testing
    - Performance profiling
    - **Validation:** Production-ready firmware

**Deliverables:**
- State machine implementation
- Robust error handling
- Optimized performance
- OTA update capability
- Complete documentation

## Testing Strategy

### Phase 1 Testing
- **Compile Test:** Firmware builds without errors
- **Upload Test:** Successfully uploads to ESP32
- **BLE Test:** Device advertises and connects
- **Data Test:** Sensor data transmits correctly
- **Duration:** 1 hour

### Phase 2 Testing
- **Functionality Test:** All features work as before
- **Performance Test:** No degradation in sample rates
- **Memory Test:** Flash and RAM usage acceptable
- **Integration Test:** All modules work together
- **Duration:** 2-3 hours

### Phase 3 Testing
- **Unit Tests:** All tests pass
- **Regression Test:** No broken functionality
- **Format Test:** Compiles in .cpp format
- **Documentation Test:** All APIs documented
- **Duration:** 1 day

### Phase 4 Testing
- **State Machine Test:** All transitions valid
- **Error Handling Test:** Recovers from failures
- **Performance Test:** Meets timing requirements
- **OTA Test:** Updates work reliably
- **Stability Test:** 24+ hour continuous operation
- **Duration:** 3-5 days

## Success Metrics

### Code Quality Metrics
- **File Size:** No file > 300 lines
- **Function Size:** No function > 50 lines
- **Cyclomatic Complexity:** < 10 per function
- **Code Duplication:** < 5%
- **Test Coverage:** > 80% for critical functions

### Performance Metrics
- **Sample Rate:** Maintain 100Hz default
- **BLE Latency:** < 50ms per transmission
- **Memory Usage:** < 80% of available
- **Power Consumption:** No increase vs baseline

### Maintainability Metrics
- **Build Time:** < 30 seconds
- **Module Coupling:** Loose (< 3 dependencies per module)
- **Module Cohesion:** High (single responsibility)
- **Documentation:** 100% public API documented

## Risk Assessment

### Low Risk
- Creating config.h (no behavior change)
- Adding logging macros (compile-time switch)
- Adding unit tests (no production impact)

### Medium Risk
- Extracting BLEManager (complex BLE logic)
- Converting .ino to .cpp (toolchain change)
- Implementing state machine (behavior change)

### High Risk
- OTA updates (can brick device if buggy)
- Error recovery (wrong logic could cause issues)
- Performance optimizations (might introduce bugs)

### Mitigation Strategy
1. **Test after each phase** - Don't accumulate changes
2. **Keep old version** - Easy rollback if needed
3. **Version control** - Tag stable releases
4. **Incremental deployment** - Test on one device first
5. **Code review** - Second pair of eyes on changes

## Rollback Plan

### If Phase 1 Fails
- Revert to current sensor_notify.ino
- Review extraction logic
- Fix issues and retry

### If Phase 2 Fails
- Keep Phase 1 changes (config.h, BLEManager)
- Revert other modules
- Re-test and retry one module at a time

### If Phase 3+ Fails
- Keep Phase 1-2 changes (functional modules)
- Defer .cpp conversion and advanced features
- Maintain .ino format if toolchain issues

## Maintenance After Refactoring

### Adding New Features
1. Identify which module owns the feature
2. Add to appropriate module (or create new one)
3. Update public interface in header
4. Add unit tests
5. Update documentation

### Fixing Bugs
1. Identify which module contains the bug
2. Fix in isolated module
3. Run unit tests
4. Test integration
5. Deploy fix

### Code Reviews
1. Check module boundaries respected
2. Verify no new global variables
3. Ensure logging levels used
4. Confirm tests added for new code
5. Validate documentation updated

## Long-term Vision

### Year 1
- Modular architecture (Phases 1-2)
- Professional C++ format (Phase 3)
- Basic unit tests

### Year 2
- State machine and error handling (Phase 4)
- Comprehensive test suite
- OTA updates
- Multi-device firmware variants

### Year 3
- Shared library for multiple products
- Automated testing pipeline
- Continuous integration
- Field telemetry and diagnostics

## Conclusion

The current firmware is functionally sound but architecturally weak. This refactoring plan provides a clear path to a maintainable, testable, professional codebase while minimizing risk through phased implementation.

**Key Benefits:**
- Reduced complexity (5 focused modules vs 1 monolith)
- Improved testability (unit tests possible)
- Better maintainability (clear module boundaries)
- Code reuse (shared modules across firmware versions)
- Professional quality (standard C++ format)

**Estimated Total Effort:**
- Phase 1: 1-2 days
- Phase 2: 1 week
- Phase 3: 2 weeks
- Phase 4: 1 month
- **Total:** ~6 weeks for complete transformation

**Recommended Starting Point:** Phase 1 - Immediate cleanup and BLEManager extraction. This provides immediate value with minimal risk.

---

**Next Steps:**
1. Review and approve this plan
2. Schedule Phase 1 implementation
3. Set up version control tags for rollback
4. Begin with config.h creation
5. Proceed methodically through phases
