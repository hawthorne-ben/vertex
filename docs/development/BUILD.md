# A Comprehensive Development Plan for a Compact Cycling IMU Data Logger

## Introduction

### Project Vision

This report outlines a comprehensive project plan for the development of a compact, battery-powered cycling IMU data logger. The primary objective is to engineer a device capable of accurately capturing multi-axis motion data and storing this information locally for subsequent analysis.

### Core Functionality

The device is designed to function as a high-resolution motion data recorder, capturing acceleration, rotation, and orientation data throughout cycling activities. By providing detailed, timestamped sensor data, the logger enables comprehensive post-ride analysis of cycling dynamics, including cornering forces, road surface quality, braking behavior, and pedaling smoothness.

### Target Audience and Prerequisites

This document is tailored for an audience with a solid foundation in electronics and software development, including advanced makers, engineering students, and practicing professionals. A working knowledge of the Arduino programming environment, fundamental circuit assembly skills such as soldering, and familiarity with 3D modeling software are considered prerequisites for successfully executing this plan.

## Use Cases

### Data Metrics and Analysis Opportunities

| Data Metric | Use Case / Analysis | Actionable Insights You Can Gain |
|-------------|---------------------|----------------------------------|
| **G-Force (Vertical)** | Road Surface & Comfort Analysis | Objectively measure road "chatter." You can test how different tire pressures, tires, or handlebars actually reduce the vibrations (G-force spikes) being sent to your body. |
| | Equipment Testing | Get real data on whether a suspension stem or carbon seatpost actually smooths out the ride compared to a standard component. |
| | Body Position Analysis | Compare the vertical G-forces when you are on the hoods, in the drops, or standing. You might find one position is far more stable and efficient at absorbing bumps. |
| **G-Force (Lateral)** | Cornering Force | See the actual G-forces you pull in a corner. This helps you find the objective limit of your tires' grip and your own confidence. |
| **G-Force (Longitudinal)** | Braking & Acceleration Analysis | Quantify your braking technique. See if you're braking hard and late (a big G-force spike) or smoothly and progressively. You can also measure the G-force of a sprint. |
| **Roll (Lean Angle)** | Cornering Technique & Asymmetry | Get hard data on your max lean angle. You'll likely discover you are less confident leaning the bike to one side (e.g., max 30° left vs. 25° right). |
| | Steering/Cornering Speed | By looking at the rate of your roll, you can analyze how quickly or "jerkily" you enter a turn, helping you practice smoother, faster cornering. |
| **Pitch (Grade)** | Pacing & Power Response | By syncing with your ride file, you can see your power/heart rate reaction to instant grade changes with high temporal resolution. |
| | Real-World Effort Mapping | Find out exactly how much a 1% grade increase really costs you in watts at a given speed. |
| **Yaw (Rotation)** | Stability & Handling Analysis | See how much you are "fighting" the bike. In heavy crosswinds, are you making constant, small steering corrections (a "noisy" yaw log)? This is a measure of stability. |
| | Maneuver Analysis | You can clearly see the yaw/rotation data for a sharp turn or a quick lane change, allowing you to analyze the bike's responsiveness. |
| **All Data Combined** | Cornering "Traction Circle" | By plotting lateral G-force (cornering) vs. longitudinal G-force (braking/accelerating), you can see how you blend these forces. The best riders can "trail-brake" (brake and corner) at the limit. |
| | Pedaling Smoothness (Inferred) | By mounting the sensor securely, you can look for high-frequency G-force oscillations. A "choppy" pedaler may create rhythmic vertical G-spikes, while a "smooth" pedaler will have a cleaner signal. |
| | Crash/Event Detection | In your log, a crash would be obvious: a massive, multi-axis G-force spike immediately followed by a wild change in roll and yaw, and then a stop. You could also easily identify harsh potholes or hard-braking events. |

### Report Structure

The plan is methodically structured into five distinct parts:
1. System architecture and component selection
2. Software environment setup and hardware prototyping
3. Firmware implementation for data acquisition and storage
4. Mechanical design and fabrication of the enclosure
5. Final assembly, testing, and deployment procedures

---

## Part 1: System Architecture and Component Selection

The foundation of any successful embedded systems project lies in the judicious selection of its core components and tools. This section details the hardware and equipment choices, justifying each based on a balance of performance, cost-effectiveness, developer support, and ecosystem compatibility.

### 1.1 Core Electronics Bill of Materials (BOM)

#### Microcontroller Unit (MCU): Adafruit Feather ESP32 V2

The Adafruit Feather ESP32 V2 is the central processing unit for this project. Selection criteria include:

- **Processing Power**: Dual-core ESP32 SoC provides ample computational resources for sensor fusion and data logging
- **Connectivity**: Integrated Wi-Fi and Bluetooth Low Energy capabilities enable future enhancements
- **Development Features**: STEMMA QT connector for plug-and-play I2C device integration dramatically simplifies prototyping
- **Power Management**: Native support for Lithium Polymer (LiPo) battery charging and monitoring via onboard JST connector
- **Storage**: Built-in flash memory suitable for data logging applications

#### Inertial Measurement Unit (IMU): Adafruit BNO055 Absolute Orientation Sensor

The Adafruit BNO055 is the chosen motion sensor for this application:

- **Sensor Suite**: Integrates 9-degree-of-freedom (9-DOF) sensing with accelerometer, gyroscope, and magnetometer
- **Sensor Fusion**: Onboard microcontroller performs sophisticated sensor fusion algorithms, offloading computational tasks from the ESP32
- **Output Data**: Provides multiple data formats including raw sensor data, quaternions, Euler angles, and linear acceleration
- **Interface Compatibility**: 3.3V logic and I2C communication protocol make it ideal for the Feather ESP32 V2
- **Sampling Rate**: Capable of up to 100Hz output rate for high-resolution motion capture

#### Data Storage: MicroSD Card Module

A microSD card breakout board is essential for storing large quantities of sensor data:

- **Capacity**: MicroSD cards (8GB-32GB recommended) provide ample storage for extended rides
- **Interface**: SPI communication protocol, universally supported by Arduino libraries
- **Compatibility**: 3.3V operation matches ESP32 voltage levels
- **Recommendation**: Adafruit MicroSD Card Breakout Board+ with STEMMA QT connector for simplified integration

#### Power Source: Lithium Polymer (LiPo) Battery

A compact, single-cell LiPo battery with capacity of 500-2000mAh depending on desired runtime:

- **Integration**: Leverages Feather's built-in JST connector and charging circuitry
- **Voltage**: 3.7V nominal, compatible with Feather power management
- **Form Factor**: Flat, flexible form factor enables compact enclosure design

#### Real-Time Clock (RTC) Module (Optional but Recommended)

A DS3231 or PCF8523 RTC module for accurate timestamping:

- **Purpose**: Maintains accurate time during power cycles and deep sleep
- **Accuracy**: Crystal-based oscillator provides precise time reference
- **Interface**: I2C communication, can share bus with IMU
- **Battery Backup**: CR1220 coin cell maintains time when main power is off

### 1.2 Recommended Tools and Equipment for Assembly and Fabrication

#### Soldering Equipment

A high-quality soldering station is indispensable for creating durable and reliable electrical connections. The quality of the soldering tool directly impacts project success.

| Model | Approx. Price | Wattage | Temperature Range | Key Features | Target User |
|-------|---------------|---------|-------------------|--------------|-------------|
| KSGER T12 | $76 | 72W | Varies by tip | Digital display, rapid heat-up, compatible with Hakko T12 tips | Hobbyist / Prosumer |
| Hakko FX-888D | $100 | 70W | 120°F - 899°F | Digital display, 5 preset temperatures, excellent thermal stability | Professional / Serious Hobbyist |

#### 3D Printing Equipment

A Fused Deposition Modeling (FDM) 3D printer is required to fabricate the custom enclosure:

| Model | Approx. Price | Build Volume | Key Features | Ecosystem | Beginner Friendliness |
|-------|---------------|--------------|--------------|-----------|----------------------|
| Prusa MINI+ | $459 | 180x180x180 mm | Auto bed leveling, network control, Bowden extruder | Open Source | High |
| Bambu Lab A1 Mini | $249 | 180x180x180 mm | Fully automatic calibration, active noise cancellation, high speed, direct drive extruder | Closed Source | Very High |

**Recommendation**: The Bambu Lab A1 Mini is recommended for beginners due to its advanced automation and high-quality prints with minimal setup.

### 1.3 System Architecture Diagram

The system's architecture centers around the ESP32 MCU:

1. **Sensor Layer**: BNO055 IMU captures raw motion data and performs sensor fusion
2. **Communication**: IMU communicates processed orientation data to ESP32 over I2C bus
3. **Processing**: ESP32 firmware coordinates data acquisition, timestamping, and formatting
4. **Storage**: Data is written to microSD card in structured format (CSV or binary)
5. **Power Management**: LiPo battery managed by Feather's onboard circuitry
6. **Timekeeping**: Optional RTC module provides accurate timestamps for logged data

#### Important Technical Consideration: I2C Pull-up Resistors

The Feather V2 datasheet notes the absence of I2C pull-up resistors on the board itself. The I2C protocol requires these resistors to function correctly. This project succeeds because the Adafruit BNO055 breakout board includes its own 10K pull-up resistors. 

**Engineering Principle**: An I2C bus requires pull-up resistors on the SCL and SDA lines, whether they are on the controller board, the peripheral board, or added externally. When adding additional I2C devices, verify that adequate pull-up resistance exists on the shared bus.

---

## Part 2: Development Environment and Hardware Prototyping

This section provides a meticulous, step-by-step guide to preparing the software toolchain and assembling a functional breadboard prototype. This structured approach serves as a critical risk mitigation strategy, validating core components before final integration.

### 2.1 Configuring the Arduino IDE for ESP32 Development

#### IDE Installation

1. Install a stable version of the Arduino IDE (version 1.8.X branch recommended)
2. Alternative: Arduino IDE 2.x offers improved interface but verify plugin compatibility

#### ESP32 Board Manager Setup

1. Navigate to **File > Preferences**
2. Add the following URL to "Additional Board Manager URLs":
   ```
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Open **Tools > Board > Boards Manager**
4. Search for "esp32"
5. Install the package provided by "Espressif Systems"

#### Board and Port Selection

1. Connect the Adafruit Feather ESP32 V2 via USB-C cable
2. Select board: **Tools > Board > ESP32 Arduino > Adafruit Feather ESP32 V2**
3. Select port: **Tools > Port > [appropriate COM/serial port]**
4. If port doesn't appear, install CP210x USB to UART bridge drivers

### 2.2 Essential Library Installation

Install the following libraries via **Sketch > Include Library > Manage Libraries**:

#### Required Libraries

- **Adafruit BNO055**: Primary driver library for the BNO055 sensor
- **Adafruit Unified Sensor**: Dependency for BNO055 library, provides standardized sensor abstraction
- **SD** or **SdFat**: Library for reading/writing to microSD cards (SdFat recommended for better performance)
- **RTClib**: Library for DS3231 or PCF8523 real-time clock modules (if using RTC)

#### Optional but Recommended Libraries

- **ArduinoJson**: For structured data logging in JSON format
- **movingAvg**: For real-time signal smoothing if needed for analysis

### 2.3 Initial Hardware Assembly and "Smoke Test"

#### Soldering Headers

1. For breadboard prototyping, solder male pin headers to:
   - Feather ESP32 V2
   - BNO055 breakout board
   - MicroSD card breakout board

2. **Best Practice**: Place long pins of headers into breadboard to hold them straight, place PCB over short pins, solder one corner pin on each side first, check alignment, then complete soldering

#### Breadboard Prototyping

**Power Connections**:
- Connect Feather **3V** pin to BNO055 **Vin** pin
- Connect Feather **3V** pin to SD card breakout **Vin** pin
- Connect all **GND** pins together

**I2C Bus (for BNO055 and optional RTC)**:
- Connect Feather **SCL** to BNO055 **SCL**
- Connect Feather **SDA** to BNO055 **SDA**
- If using RTC, share the same SCL/SDA lines
- **Alternative**: Use STEMMA QT cables for solder-free connection

**SPI Bus (for SD Card)**:
- Connect Feather **MOSI** to SD **MOSI/DI**
- Connect Feather **MISO** to SD **MISO/DO**
- Connect Feather **SCK** to SD **SCK/CLK**
- Connect Feather **GPIO** pin (e.g., pin 33) to SD **CS** (chip select)

#### Verification Sketch: IMU Test

1. Open the **sensorapi** example sketch from the Adafruit BNO055 library
2. Upload to the Feather ESP32 V2
3. Open Serial Monitor at **9600 baud**
4. Verify orientation data is displayed correctly

#### Verification Sketch: SD Card Test

1. Open **File > Examples > SD > CardInfo**
2. Modify the chip select pin to match your wiring (e.g., `const int chipSelect = 33;`)
3. Upload and open Serial Monitor
4. Verify SD card is detected and information is displayed

**Success Criteria**: Both peripherals functioning independently validates the hardware foundation before firmware integration.

### 2.4 Engineering Principle: Incremental Validation

This incremental approach systematically isolates potential points of failure. If tests fail, problems are immediately localized to hardware, wiring, or driver configuration, rather than being confounded with complex application logic. This disciplined method prevents hours of frustrating debugging by ensuring the project's foundation is solid before more complex layers are added.

---

## Part 3: Firmware Architecture and Implementation

This section constitutes the technical core of the project, detailing firmware development from raw data acquisition to structured data logging, signal processing, and power management.

### 3.1 Acquiring Accurate Orientation: Mitigating the BNO055 Euler Bug

#### The Problem: BNO055 Euler Angle Limitation

Community-driven analysis has revealed that the BNO055's proprietary fusion algorithm produces highly inaccurate and unreliable Euler angles when the device is tilted beyond approximately 20 degrees from horizontal. This is not gimbal lock but a distinct firmware flaw in the sensor's internal calculations.

#### The Solution: Quaternion-Based Approach

To build a reliable motion logger, this flawed output must be bypassed:

1. **Read Quaternion Data**: Use `bno.getQuat()` to retrieve raw quaternion representation
2. **Convert to Euler Angles**: Use `quat.toEuler()` helper function to obtain roll, pitch, and yaw
3. **Log Both Representations**: Store both quaternion and Euler angle data for maximum analysis flexibility

#### Data to Capture from BNO055

For comprehensive motion analysis, log the following data streams:

- **Quaternion**: 4 values (w, x, y, z) - lossless orientation representation
- **Euler Angles**: 3 values (roll, pitch, yaw) - intuitive orientation
- **Linear Acceleration**: 3 values (x, y, z) - acceleration with gravity removed
- **Angular Velocity**: 3 values (x, y, z) - rotation rates from gyroscope
- **Magnetic Field**: 3 values (x, y, z) - compass data for heading analysis
- **Calibration Status**: 4 values (system, gyro, accel, mag) - data quality indicators

### 3.2 Data Logging Strategy

#### File Format Selection

**CSV Format (Recommended for Beginners)**:
- **Advantages**: Human-readable, universally compatible, easy to import into Excel/Python/MATLAB
- **Disadvantages**: Larger file size, slower write operations
- **Use Case**: General purpose logging, post-processing with standard tools

**Binary Format (Advanced)**:
- **Advantages**: Compact file size, faster write operations, higher sampling rates possible
- **Disadvantages**: Requires custom parsing software
- **Use Case**: High-frequency logging (>50Hz), extended rides, storage constraints

#### Data Structure for CSV Logging

```
Timestamp,Quat_W,Quat_X,Quat_Y,Quat_Z,Roll,Pitch,Yaw,Accel_X,Accel_Y,Accel_Z,Gyro_X,Gyro_Y,Gyro_Z,Mag_X,Mag_Y,Mag_Z,Cal_Sys,Cal_Gyro,Cal_Accel,Cal_Mag
```

#### File Management Strategy

1. **File Naming**: Use descriptive names with timestamps (e.g., `ride_20251021_143022.csv`)
2. **File Rotation**: Create new file if current file exceeds size threshold (e.g., 10MB) to prevent corruption
3. **Write Buffering**: Accumulate multiple samples in RAM before SD write to reduce write cycles and improve performance
4. **Safe Shutdown**: Implement button press or timeout to ensure file is properly closed before power-off

### 3.3 Real-Time Clock Integration for Accurate Timestamping

#### Why RTC is Important

- ESP32 has no built-in battery-backed clock
- Accurate timestamps essential for syncing with other cycling data (power meters, heart rate, GPS)
- RTC maintains time through power cycles and sleep modes

#### Implementation

1. Initialize RTC module at startup: `rtc.begin()`
2. Set time once via USB serial connection or compile-time macro
3. Read timestamp before each sensor sample: `rtc.now()`
4. Format as Unix timestamp (seconds since epoch) or ISO 8601 string

### 3.4 MVP Operational Mode: Always-On Continuous Logging

For the proof-of-concept without physical buttons, the simplest and most practical approach is an always-on operational model.

#### Operational Concept

**Power Management**:
- Device powers on automatically when battery is connected or USB is plugged in
- No power switch required
- Device powers off only when battery is depleted

**Logging Behavior**:
- Logging begins immediately upon power-on (no button press needed)
- Continues logging until power loss
- Auto-resumes logging with new file after recharging

**User Workflow**:
1. Charge device via USB-C (Feather's onboard charger handles this automatically)
2. Unplug and mount to bike
3. Ride (device logs entire duration)
4. Return home, plug in USB-C to charge for next ride
5. Download log files from SD card when convenient

#### File Rotation Strategy

To organize continuous logging into manageable chunks:

**Time-Based Rotation (Recommended)**:
```cpp
const unsigned long FILE_ROTATION_INTERVAL = 30 * 60 * 1000; // 30 minutes
unsigned long lastFileRotation = 0;
File dataFile;

void loop() {
  // ... sensor reading and logging ...
  
  // Check if it's time to rotate files
  if (millis() - lastFileRotation > FILE_ROTATION_INTERVAL) {
    dataFile.close();
    createNewFile();  // New file with timestamp
    lastFileRotation = millis();
  }
}
```

**File Naming Convention**:
```
ride_20251021_143022.csv  // Created at 2:30:22 PM
ride_20251021_150022.csv  // 30 minutes later
ride_20251021_153022.csv  // 30 minutes later
```

**Benefits**:
- Each ride naturally spans multiple files (easy to identify ride segments)
- Corrupted file only affects one 30-minute segment
- Easier to process smaller files

**Alternative: Size-Based Rotation** (if files get too large):
```cpp
const unsigned long MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

if (dataFile.size() > MAX_FILE_SIZE) {
  dataFile.close();
  createNewFile();
}
```

#### Data Integrity and Power Loss Recovery

**Problem**: If battery dies mid-write, current file may be corrupted and recent data lost.

**Solution**: Periodic Buffer Flushing
```cpp
const unsigned long FLUSH_INTERVAL = 5000; // Flush every 5 seconds
unsigned long lastFlush = 0;

void loop() {
  // Write sensor data to file buffer (in RAM)
  dataFile.println(dataString);
  
  // Periodically force write to SD card
  if (millis() - lastFlush > FLUSH_INTERVAL) {
    dataFile.flush();  // Commits buffered data to SD card
    lastFlush = millis();
  }
}
```

**Result**:
- Maximum 5 seconds of data lost in sudden power loss
- File remains valid and readable up to last flush point
- On recharge/reboot, firmware creates new file and logging resumes

#### Complete MVP Firmware Structure

```cpp
#include <Adafruit_BNO055.h>
#include <SD.h>
#include <RTClib.h>

Adafruit_BNO055 bno = Adafruit_BNO055(55);
RTC_DS3231 rtc;
File dataFile;

const unsigned long FILE_ROTATION_INTERVAL = 30 * 60 * 1000;
const unsigned long FLUSH_INTERVAL = 5000;
unsigned long lastFileRotation = 0;
unsigned long lastFlush = 0;

void setup() {
  Serial.begin(115200);
  
  // Initialize sensors
  if (!bno.begin()) {
    Serial.println("BNO055 error!");
    while(1);
  }
  
  if (!rtc.begin()) {
    Serial.println("RTC error!");
    while(1);
  }
  
  if (!SD.begin(SD_CS_PIN)) {
    Serial.println("SD card error!");
    while(1);
  }
  
  // Create initial log file
  createNewFile();
  
  Serial.println("Logging started!");
}

void loop() {
  // Read sensors
  imu::Quaternion quat = bno.getQuat();
  imu::Vector<3> euler = quat.toEuler();
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_LINEARACCEL);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  
  // Get timestamp
  DateTime now = rtc.now();
  
  // Write to file buffer
  dataFile.print(now.unixtime());
  dataFile.print(",");
  dataFile.print(quat.w()); dataFile.print(",");
  dataFile.print(quat.x()); dataFile.print(",");
  dataFile.print(quat.y()); dataFile.print(",");
  dataFile.print(quat.z()); dataFile.print(",");
  // ... write other sensor data ...
  dataFile.println();
  
  // Periodic flush for data integrity
  if (millis() - lastFlush > FLUSH_INTERVAL) {
    dataFile.flush();
    lastFlush = millis();
  }
  
  // File rotation
  if (millis() - lastFileRotation > FILE_ROTATION_INTERVAL) {
    dataFile.close();
    createNewFile();
    lastFileRotation = millis();
  }
  
  delay(20);  // 50 Hz sampling rate
}

void createNewFile() {
  DateTime now = rtc.now();
  char filename[32];
  sprintf(filename, "ride_%04d%02d%02d_%02d%02d%02d.csv", 
          now.year(), now.month(), now.day(),
          now.hour(), now.minute(), now.second());
  
  dataFile = SD.open(filename, FILE_WRITE);
  
  // Write CSV header
  dataFile.println("Timestamp,Quat_W,Quat_X,Quat_Y,Quat_Z,Roll,Pitch,Yaw,Accel_X,Accel_Y,Accel_Z,Gyro_X,Gyro_Y,Gyro_Z");
  
  lastFileRotation = millis();
}
```

**This approach**:
- ✅ Requires no buttons for MVP
- ✅ Auto-starts logging on power-on
- ✅ Organizes data into time-based segments
- ✅ Survives power loss gracefully
- ✅ Simple and reliable

#### Optional: Charging Detection

To avoid logging while device is charging on your desk:

```cpp
#define USB_DETECT_PIN A13  // Or appropriate pin for USB detection

bool isCharging() {
  float voltage = analogRead(USB_DETECT_PIN) * 3.3 / 4096.0;
  return (voltage > 4.5);  // USB voltage present
}

void loop() {
  if (isCharging()) {
    // Skip logging while plugged in, just charge
    delay(1000);
    return;
  }
  
  // Not charging - log normally
  // ... rest of loop code ...
}
```

**For true MVP simplicity**: Skip charging detection. Let it log continuously. Post-processing can easily identify and remove "stationary" segments.

### 3.5 Alternative Firmware Architectures

The following architectures are alternatives to the always-on MVP mode, provided here for reference but not recommended for the initial proof-of-concept.

#### High-Frequency Logging Mode (Legacy Reference)

For maximum data resolution with button-based control:

```cpp
void setup() {
  // Initialize serial, I2C, sensors, SD card, RTC
  // Wait for button press to start logging
}

void loop() {
  if (loggingEnabled) {
    // Read current timestamp from RTC
    // Read all sensor data from BNO055
    // Append to RAM buffer
    
    // Every N samples (e.g., 10):
    //   - Flush buffer to SD card
    //   - Blink LED to indicate activity
  }
  
  // Delay to achieve target sample rate (e.g., 20ms for 50Hz)
}
```

#### Power-Optimized Logging Mode with Deep Sleep

For extended battery life (days to weeks) with very low sampling rate:

```cpp
void setup() {
  // Initialize hardware
  // Read sensors
  // Log single sample to SD card
  // Enter deep sleep for configured interval (e.g., 60 seconds)
}

void loop() {
  // Empty - execution restarts in setup() after wake
}
```

**Note**: Deep sleep is not practical for the MVP cycling use case, which requires continuous high-frequency data capture

### 3.6 Power Management and Battery Monitoring

#### Battery Voltage Monitoring

The Feather ESP32 V2 includes a voltage divider for monitoring battery level:

1. Read analog pin A13 to get battery voltage
2. Convert ADC reading to voltage: `voltage = analogRead(A13) * 2 * 3.3 / 4096`
3. Log battery voltage periodically to track power consumption
4. Implement low-battery warning (e.g., <3.4V)

#### Power Optimization Techniques

- **Reduce Sampling Rate**: 10-20Hz sufficient for most cycling analysis
- **Disable Unused Features**: Turn off Wi-Fi/Bluetooth if not needed
- **LED Management**: Minimize LED on-time or disable after initialization
- **Deep Sleep Between Rides**: Implement activity detection to enter sleep mode when stationary

### 3.7 Error Handling and Data Integrity

#### Critical Error Checks

1. **SD Card Write Verification**: Check return value of all `file.print()` operations
2. **Sensor Communication**: Monitor I2C errors and log to detect intermittent failures
3. **Storage Space**: Check available SD card space before each ride
4. **Data Corruption**: Write file header and footer to validate complete recordings

#### LED Status Indicators

Implement visual feedback for debugging without serial connection:

- **Solid Green**: Initialization successful, ready to log
- **Blinking Green**: Actively logging data
- **Red Flash**: Error condition (SD card failure, sensor error)
- **Yellow Blink**: Low battery warning

---

## Part 4: Hardware Design & Form Factor

This section details two alternative mechanical designs for the IMU logger, both utilizing the industry-standard Garmin quarter-turn mounting system for seatpost installation. The designs balance functionality, aerodynamics, and integration with existing cycling accessories (particularly the Garmin Varia radar).

**Design Philosophy**: Mount to seatpost for optimal whole-bike motion capture, compatibility with existing Garmin ecosystem, and central positioning that doesn't interfere with riding dynamics.

**Two Form Factor Options**:
1. **Independent Unit**: Standalone device that mounts directly to seatpost via Garmin mount
2. **Stacked Design**: Pass-through device that allows Garmin Varia radar to stack on top

Both options are fabricated using FDM 3D printing with weatherproof enclosures housing the ESP32, BNO055 IMU, SD card reader, and LiPo battery.

### 4.1 Physical Specifications (Common to Both Options)
- **Weight**: Target <60g including battery
- **Enclosure**: Weatherproof (IP65+ rated), black matte PETG/ASA
- **Battery**: Rechargeable Li-Po, USB-C charging, 10-15 hour runtime
- **Mounting**: Standard Garmin quarter-turn interface (universal compatibility)
- **Location**: Seatpost (optimal for whole-bike dynamics measurement)

### 4.2 Form Factor Options

#### **Option 1: Independent Unit (Standalone)**

Two variants of the standalone design:

**A. MVP Version - "The Box"**
- **Dimensions**: 60mm (L) × 35mm (W) × 25mm (H)
- **Profile**: Utilitarian rectangular enclosure
- **Mount**: Garmin quarter-turn base adapter on bottom
- **Features**:
  - Side-mounted USB-C port with rubber seal
  - Single RGB LED status indicator
  - Clear X/Y/Z axis orientation markings
  - Basic weatherproof construction
- **Best for**: Proof of concept, rapid prototyping, minimal cost

**B. Ideal Version - "Aero Pod"**
- **Dimensions**: 70mm (L) × 30mm (W) × 20mm (H)
- **Profile**: Teardrop/aero shape with tapered rear (Kamm tail)
- **Mount**: Integrated Garmin quarter-turn interface
- **Features**:
  - Flush USB-C port with integrated seal
  - Recessed LED indicator
  - NACA duct for passive cooling
  - Carbon fiber texture finish
  - Optimized for minimal drag
  - Premium aesthetic matching high-end cycling products
- **Best for**: Production version, performance-oriented riders

#### **Option 2: Stacked Design (Varia-Compatible)**

**Varia Radar Integration**
- **Dimensions**: 40mm diameter × 25mm height (IMU section only)
- **Profile**: Cylindrical to match Garmin Varia aesthetic
- **Mount System**:
  - **Bottom**: Garmin quarter-turn male interface (mounts to seatpost adapter)
  - **Top**: Garmin quarter-turn female interface (Varia mounts on top)
  - Creates sandwich: Seatpost Adapter → IMU Device → Varia Radar
- **Features**:
  - Pass-through design maintains full Varia functionality
  - Same diameter as Varia (minimizes added frontal area)
  - Smooth cylindrical profile for consistent airflow
  - Side-mounted USB-C port (accessible when stacked)
  - Minimal height addition (<30mm to total stack)
  - LED status ring around top edge
  - Integrated cable management channels (if needed)
- **Best for**: Users who already own Garmin Varia, prefer integrated ecosystem

### 4.3 Mounting Location: Seatpost

All form factors mount to seatpost via Garmin quarter-turn mount:

**Why Seatpost?**
- Central location captures whole-bike motion (frame + rider system)
- Rigid connection via standard Garmin mount (no flex)
- Universal compatibility (works with any bike that has round seatpost)
- No interference with riding (hands, legs, steering)
- Compatible with existing Garmin computer/radar mounts
- Easy installation/removal (quarter-turn, tool-free)

**Installation**:
- Use standard Garmin seatpost mount adapter
- Position below saddle, typically 10-15cm down from saddle clamp
- Orient device with forward-facing marking aligned to direction of travel
- Quarter-turn clockwise to lock in place

### 4.4 Common Design Requirements

1. **Rigid Mounting** - Garmin mount provides solid mechanical connection
2. **Known Orientation** - Clear X/Y/Z axis markings (critical for data analysis)
3. **Weatherproofing** - IP65+ rating, sealed USB port, drainage channels
4. **Aerodynamic Consideration** - Streamlined profiles (especially Aero Pod and Stacked)
5. **Easy Access** - USB-C port accessible without removing device from bike
6. **Status Indicators** - LED for power/recording/battery/errors
7. **Garmin Ecosystem Compatibility** - Standard quarter-turn interface
8. **Minimal Weight** - <60g to avoid affecting bike handling

### 4.5 Understanding the Garmin Quarter-Turn Mounting System

#### 4.5.1 Mount Architecture Overview

The Garmin quarter-turn mount is a two-part mechanical interface standard used across the cycling industry:

**Male Component (Bottom of Device)**:
- Two opposing lugs with ramped engagement surfaces
- Rotates 90 degrees (quarter turn) to lock into female mount
- Integrated into the device enclosure bottom surface
- Must have sufficient structural strength to support device weight and impact loads

**Female Component (Seatpost Mount Adapter)**:
- Two opposing slots with locking ramps
- Clamps around seatpost with standard Garmin mounting interface
- Compatible with all Garmin devices and third-party accessories
- Provides secure, tool-free attachment/removal

**For Stacked Design**: The IMU device has BOTH male (bottom) and female (top) quarter-turn interfaces, creating a pass-through system that allows the Varia radar to mount on top while the IMU mounts to the seatpost adapter below.

### 4.6 Design Constraints and Component Layout

#### 4.6.1 Size Constraints by Form Factor

**Independent Unit (Box/Aero):**
- Flexibility in dimensions (not constrained by existing device profile)
- Prioritize low aerodynamic drag and minimal visual impact
- House all components (ESP32, BNO055, SD, battery) in single enclosure

**Stacked Design (Varia-Compatible):**
- Must match Varia diameter (40mm) for visual/aerodynamic consistency
- Height constrained to minimize added stack height (<30mm)
- Pass-through design requires vertical component arrangement

#### 4.2.2 PCB Stacking vs Horizontal Layout

**Horizontal Layout (Recommended for Low Profile)**:
- All PCBs mounted flat on enclosure floor
- Maximizes XY footprint usage
- Minimizes Z-axis height
- Best for achieving <13mm device height

**Vertical Stacking (Alternative for Smaller Footprint)**:
- Stack smaller boards (RTC, SD) above main boards using standoffs
- Reduces XY footprint requirement
- Increases Z-axis height to 16-18mm
- May exceed Coros Dura height compatibility

**Recommendation**: Use horizontal layout with thin LiPo battery to prioritize minimal height.

### 4.3 Enclosure Design in Autodesk Fusion 360

#### 4.3.1 Initial Setup and Component Modeling

1. **Start New Design**:
   - Create new design in Fusion 360
   - Set units to millimeters
   - Enable "Component" modeling mode for better organization

2. **Import or Model Component Bodies**:
   - **Method 1**: Download STEP files from Adafruit (if available) and import
   - **Method 2**: Create simplified rectangular bodies matching measured dimensions:
     - Feather ESP32 V2: 51×23×8mm
     - BNO055: 27×20×4mm
     - SD Card Breakout: 28×32×3mm
     - RTC: 25×25×3mm
     - Battery: Measure your specific battery

3. **Arrange Components in 3D Space**:
   - Position components within 95×56mm working area (allows 2-3mm wall thickness)
   - Maintain 2-3mm clearance between components
   - Orient Feather with USB-C port facing enclosure edge
   - Verify no overlapping volumes

#### 4.3.2 Creating the Main Body

**Step 1: Create Base Sketch**:
- Sketch rectangle: 99.5×60.8mm (Coros Dura maximum footprint)
- Center on origin for symmetric design
- Consider rounding corners (3-5mm radius) for ergonomics and mount clearance

**Step 2: Extrude Base Platform**:
- Extrude sketch 2mm thickness for structural base
- This forms the floor of the enclosure

**Step 3: Create Perimeter Walls**:
- Offset base perimeter inward by wall thickness (2-3mm)
- Extrude walls upward to accommodate tallest component + clearance
- Target wall height: 9-10mm (allows 8mm Feather + 1mm clearance)

**Step 4: Add Internal Mounting Features**:
- **PCB Standoffs**: Create cylindrical bosses (3-4mm diameter, height matching PCB elevation)
- Position standoffs aligned with mounting holes on each PCB
- Model M2 screw holes (2.2mm diameter) through standoff tops
- **Cable Management**: Add small clips or channels for wire routing
- **Battery Retention**: Model ribs or compression fit cavity for LiPo battery

**Step 5: Create Port Access Cutouts**:
- **USB-C Port**: 9×4mm slot positioned at Feather location (for charging)
- **SD Card Slot**: 15×2.5mm slot for card insertion (required for MVP - data retrieval requires removing SD card)
  - Position slot to allow card removal without opening entire enclosure
  - Consider spring-loaded SD card socket for easier ejection
  - Alternative: Design for easy lid removal if card slot cutout is impractical
- **LED Light Pipe** (optional): Small cylindrical hole if status LED needed
- Apply draft angle (2-3°) to cutouts for easier 3D printing

**Note on Data Access**: The MVP requires physical SD card removal for data download. The ESP32 cannot present the SD card as USB mass storage when plugged into USB-C. See Appendix E.4 for V2 wireless transfer options.

**Manufacturing Tolerances**:
- Use "Offset Face" tool to expand internal cavity by 0.4mm
- Ensures components fit despite printer dimensional variance
- Verify clearances with measuring tools in Fusion 360

#### 4.3.3 Integrating the Male Quarter-Turn Mount

**Step 1: Source Mount Geometry**:
- Download Garmin male quarter-turn mount model from:
  - Thingiverse: "Garmin Quarter Turn Mount Plate" 
  - Printables: Search "Garmin male mount"
- Prefer models with editable source files (.f3d, .step, .stl)

**Step 2: Import Mount into Design**:
- **File → Insert → Insert Mesh** (for STL files)
- Or **Insert → Insert into Current Design** (for Fusion files)
- Position mount centered on enclosure bottom exterior surface

**Step 3: Boolean Union (Join) Operation**:
- **Modify → Combine**
- Select enclosure base body as target
- Select mount geometry as tool
- Operation: **Join**
- Result: Single unified body with integrated mount

**Step 4: Verify Mount Clearances**:
- Check that mount lugs don't interfere with wall structure
- Ensure mount engagement surfaces are properly oriented
- Test that rotation path is clear of obstructions

**Alternative: Model Mount from Scratch**:
If suitable models aren't available, model the male mount:
- Reference dimensions from official Garmin mount specifications
- Two opposing rectangular lugs (approximately 20×8mm)
- 1-2mm engagement ramp on each lug
- 3-4mm protrusion below base surface

#### 4.3.4 Designing the Lid

**Step 1: Create Lid Profile**:
- Sketch rectangle matching outer dimensions of main body
- Offset inward by 0.2-0.3mm for clearance

**Step 2: Extrude Lid Body**:
- Extrude 1.5-2mm thickness for structural integrity
- Keep thin to minimize total device height

**Step 3: Add Retention Features**:
- **Snap-Fit Tabs**: Model flexible clips around perimeter (requires design for printability)
- **Screw Bosses**: Add cylindrical bosses in corners with M2 screw holes
- **Sealing Lip**: Small raised perimeter (0.5mm) can improve water resistance

**Step 4: Internal Retention Features**:
- Consider adding small bosses that press against top of tallest component
- Prevents PCBs from rattling during vibration

### 4.4 Using Generative Design for Mount Optimization in Fusion 360

Generative Design in Fusion 360 uses AI to create optimized structures based on your constraints and objectives. This is particularly valuable for creating a strong, lightweight mount that connects the enclosure base to the Garmin quarter-turn interface.

#### 4.4.1 Accessing Generative Design in Fusion 360

**Prerequisites**:
- Fusion 360 subscription with cloud credits (generative design requires cloud computation)
- Completed base enclosure design with male quarter-turn mount

**Access Path**:
1. In Fusion 360 workspace, click **Design** dropdown in top toolbar
2. Select **Generative Design** workspace
3. Or: Click **Create** → **Create Generative Design Study**

**Note**: Generative Design is cloud-based and consumes cloud credits. Check your subscription for available credits.

#### 4.4.2 Step-by-Step Generative Design Workflow

**Step 1: Create Generative Design Study**

1. In Generative Design workspace, click **Create Study**
2. Name study: "Quarter_Turn_Mount_Optimization"
3. Select base enclosure body as starting geometry

**Step 2: Define Preserve Geometry**

Preserve geometry defines regions that must remain unchanged in the final design:

1. Click **Preserve Geometry** in study setup
2. Select the following faces/bodies:
   - **Top mounting surface**: Where enclosure base attaches (must remain flat)
   - **Male quarter-turn lugs**: Complete lug geometry (engagement surfaces critical)
   - **Screw holes**: Any threaded holes for enclosure attachment
3. These features will remain untouched; AI designs around them

**Step 3: Define Obstacle Geometry**

Obstacle geometry defines "keep-out zones" where no material can be added:

1. Click **Obstacle Geometry** in study setup
2. Model and select keep-out regions:
   - **Quarter-turn rotation path**: Cylindrical volume swept by lugs during 90° rotation
   - **Enclosure interior volume**: Prevents mount from intruding into electronics cavity
   - **Finger access clearance**: 10-15mm radius around mount for hand operation
3. Create obstacle volumes using sketch + extrude in standard Design workspace
4. Switch back to Generative Design workspace to select them

**Step 4: Apply Structural Constraints**

Define how the mount is attached to the bike:

1. Click **Structural Constraints**
2. Select mount bottom surface (where it contacts bike mount)
3. Choose **Fixed** constraint type
4. This simulates the mount being rigidly attached to the bicycle

**Step 5: Apply Structural Loads**

Define forces the mount must withstand:

1. Click **Structural Loads** → **Add Load**
2. **Load 1 - Static Weight**:
   - Select top mounting surface
   - Type: **Force**
   - Magnitude: **10 N** (approximately 1kg device weight × gravity)
   - Direction: Downward (Z-axis)

3. **Load 2 - Impact Load**:
   - Select same surface
   - Type: **Force**
   - Magnitude: **100 N** (10× static for pothole impacts)
   - Direction: Downward

4. **Load 3 - Lateral Force**:
   - Select top mounting surface
   - Type: **Force**  
   - Magnitude: **30 N** (cornering/vibration)
   - Direction: Y-axis (lateral)

**Multiple load cases**: Generative Design can evaluate all load scenarios simultaneously.

**Step 6: Set Manufacturing Method**

Tell the AI that you're 3D printing:

1. Click **Manufacturing Method**
2. Select **Additive Manufacturing**
3. Build direction: **Z-axis** (vertical, matching typical printer orientation)
4. This ensures AI creates geometries that can be printed without excessive supports

**Step 7: Select Material**

1. Click **Material** in study setup
2. From material library, select **PETG** or **PLA** (choose closest available)
3. If exact material not listed, use **Generic Rigid Polymer**
4. Material properties inform strength calculations

**Step 8: Define Objectives**

1. Click **Objectives**
2. Set primary objective: **Minimize Mass**
3. Add constraint: **Factor of Safety ≥ 2.0**
   - This ensures the design is at least 2× stronger than required for applied loads
4. Optional: Set maximum mass limit (e.g., 20g for mount structure)

**Step 9: Generate Design**

1. Click **Generate** button
2. Fusion 360 uploads parameters to cloud
3. Wait for computation (typically 15-45 minutes depending on complexity)
4. Multiple design alternatives will be generated

**Step 10: Explore and Compare Results**

1. Once generation completes, Fusion displays multiple design alternatives
2. Use slider to view different options
3. Sort by criteria:
   - **Mass** (lightest designs)
   - **Factor of Safety** (strongest designs)  
   - **Aesthetics** (visual preference)
4. View stress distribution heat maps to understand load paths
5. Compare designs side-by-side

**Step 11: Select and Export Final Design**

1. Choose preferred design from alternatives
2. Click **Export**
3. Export options:
   - **Mesh Body**: Exports as mesh (can be smoothed and refined)
   - **Edit in Design Workspace**: Converts to parametric solid body (recommended)
4. If exporting to Design workspace:
   - AI-generated geometry appears as new body
   - Can be further refined with traditional CAD tools
   - Merge with main enclosure using Boolean operations

**Step 12: Post-Processing the Generative Design**

1. Generative designs often have organic, irregular surfaces
2. Use **Modify → Smooth** to refine surface quality
3. Use **Mesh → Remesh** to improve mesh topology
4. Verify printability:
   - Check for overhangs >45° (may need supports)
   - Identify thin features that may not print reliably
   - Ensure minimum wall thickness ≥1.5mm

#### 4.4.3 Alternative: Traditional Mount Design

If generative design is unavailable or unsuitable, design the mount structure manually:

1. Create solid boss connecting base to quarter-turn lugs
2. Add 3-4 support ribs radiating from center
3. Fillet all internal corners (3-5mm radius) to reduce stress concentrations
4. Maintain minimum 3mm wall thickness throughout
5. Use manual FEA (Fusion 360: **Simulation** workspace) to validate strength

### 4.5 Design Considerations for Sensor Orientation

**Critical Alignment**:
- Mount BNO055 IMU with sensor axes aligned to bicycle reference frame
- Document orientation clearly in enclosure (label X, Y, Z or use asymmetric shape)
- Consider permanent labels or engraved markings on enclosure exterior

**Installation Guidance**:
- Include clear indication of "FORWARD" direction on device exterior
- Misalignment of IMU axes will corrupt analysis (e.g., pitch/roll confusion)

**Vibration Isolation** (Optional):
- For this application, **rigid mounting is preferred** to capture true frame dynamics
- Rubber damping would filter out valuable vibration data

### 4.6 3D Printing for Durability

#### Material Selection: PETG

**Recommended Material**: PETG (Polyethylene Terephthalate Glycol)

**Advantages over PLA**:
- Superior layer adhesion
- Better UV resistance for outdoor use
- Higher glass transition temperature (survives hot summer days)
- Good impact resistance

**Alternative**: ASA (Acrylonitrile Styrene Acrylate)
- Even better UV resistance
- Higher temperature resistance
- More difficult to print (requires enclosure, higher temps)

#### Critical Slicer Settings

**Part Orientation**:
- Orient to maximize strength of mount tabs
- Print with layers parallel to enclosure bottom face
- Ensures mount tabs are not printed with layer lines along shear plane

**Infill**:
- **Recommended**: 40-50% infill for structural areas
- **Pattern**: Gyroid or honeycomb for best strength-to-weight ratio
- **Perimeters**: 3-4 perimeter walls for impact resistance

**Supports**:
- Use "tree" or "organic" style supports
- More efficient material usage
- Easier removal during post-processing
- Less surface scarring

**Print Speed and Temperature**:
- PETG: 230-250°C nozzle, 70-80°C bed
- Slower speeds (40-60mm/s) for better layer adhesion
- Cooling fan: 30-50% (too much cooling causes layer delamination)

#### Post-Processing

1. **Support Removal**: Carefully remove support structures with flush cutters
2. **Hole Cleanup**: Drill out screw holes if needed for proper fit
3. **Deburring**: Remove any sharp edges or stringing
4. **Test Fit**: Verify all electronics fit properly before final assembly

---

## Part 5: Final Assembly, Testing, and Deployment

This final phase integrates electronic and mechanical components into a finished product, followed by systematic verification and field testing procedures.

### 5.1 Final Electronic Assembly

#### Soldering Permanent Connections

For production assembly, solder wires directly to boards instead of using breadboard:

1. **I2C Bus Wiring**:
   - Use 26-28 AWG stranded wire
   - Solder SDA, SCL between Feather, BNO055, and RTC
   - Keep wire lengths short (<10cm) to reduce noise
   - Alternatively, use STEMMA QT cables for plug-and-play connections

2. **SPI Bus Wiring** (for SD card):
   - Use 26-28 AWG stranded wire for MOSI, MISO, SCK, CS
   - Keep wires twisted or bundled to reduce EMI

3. **Power Distribution**:
   - Connect 3.3V and GND to all modules
   - Use star topology (all grounds meet at one point) to minimize ground loops

4. **Heat Shrink Tubing**: Cover all exposed solder joints

#### PCB Mounting

1. Install assembled electronics into 3D-printed enclosure
2. Secure PCBs to mounting bosses with M2 or M2.5 screws
3. Verify no short circuits between components and enclosure

#### Battery Installation

1. Connect LiPo battery to JST connector on Feather
2. Secure battery with double-sided foam tape
3. Ensure battery cannot move or short against other components
4. Route wires to avoid pinch points when closing enclosure

#### Final Enclosure Assembly

1. Verify all components are secure
2. Close lid and engage snap-fit mechanism or install screws
3. Test that USB-C port is accessible and SD card can be inserted/removed

### 5.2 Firmware Upload and Configuration

#### Final Firmware Upload

1. Connect device via USB-C cable
2. Upload complete data logger firmware to ESP32
3. Open Serial Monitor to verify initialization sequence
4. Check for error messages related to sensors or SD card

#### RTC Time Setting

If using RTC module:

1. Modify firmware with current date/time or use serial command
2. Upload and verify time is set correctly
3. Disconnect and reconnect power to ensure time persists

#### Configuration Parameters to Set

- **Sampling Rate**: Set to desired frequency (10-50Hz recommended)
- **File Naming**: Configure ride numbering or date-based names
- **Low Battery Threshold**: Set voltage level for warnings
- **LED Behavior**: Configure status indicators for field use

### 5.3 Bench Testing and Validation

#### Test 1: Sensor Data Quality

1. Power on device and start logging
2. Perform controlled movements:
   - Rotate device through all axes
   - Gentle shaking (simulates riding vibrations)
   - Sudden stops (simulates braking)
3. Review logged data:
   - Verify all sensor channels contain valid data
   - Check for missing samples or corrupted values
   - Confirm calibration status is maintained

#### Test 2: Storage Performance

1. Calculate expected file size: `(samples_per_second × bytes_per_sample × test_duration)`
2. Run extended logging test (30-60 minutes)
3. Verify:
   - File size matches expectations
   - No data corruption in file
   - SD card has sufficient free space
   - Battery voltage remains stable

#### Test 3: Power Consumption and Runtime

1. Fully charge LiPo battery
2. Start logging and note start time
3. Monitor battery voltage over time
4. Calculate runtime: `capacity_mAh / average_current_mA`
5. Expected runtime examples:
   - 500mAh battery at 50mA draw = 10 hours
   - 1000mAh battery at 50mA draw = 20 hours
   - 2000mAh battery at 100mA draw = 20 hours

#### Test 4: Data Synchronization

1. If integrating with GPS-enabled cycling computer:
   - Start both devices simultaneously
   - Record ride with known features (hills, turns, stops)
   - Post-process to verify timestamps align
   - Consider GPS time sync for automatic alignment

### 5.4 Field Testing Protocol

#### Initial Short Ride (Validation)

1. **Preparation**:
   - Fully charge battery
   - Insert freshly formatted SD card
   - Mount device securely to bike using quarter-turn mount

2. **During Ride** (15-30 minutes):
   - Perform variety of maneuvers:
     - Flat road at steady speed
     - Climbing and descending
     - Hard cornering (both directions)
     - Emergency braking
     - Rough road surface
     - Smooth road surface

3. **Post-Ride Analysis**:
   - Download data file from SD card
   - Import into analysis software (Excel, Python, MATLAB)
   - Verify data quality throughout ride
   - Check for:
     - Missing data segments
     - Sensor calibration drift
     - Excessive noise
     - Proper orientation (axes aligned as expected)

#### Extended Ride (Real-World Validation)

1. After successful short rides, conduct longer rides (1-3 hours)
2. Monitor battery life and storage capacity
3. Evaluate:
   - Enclosure durability
   - Mount security
   - Waterproofing (if riding in wet conditions)
   - Temperature effects (hot/cold weather)

### 5.5 Data Analysis Workflow

#### Software Tools

**Option 1: Excel/Google Sheets**
- Suitable for basic visualization and statistical analysis
- Can handle files up to ~1 million rows
- Limited advanced processing capabilities

**Option 2: Python (Recommended)**
- Use libraries: pandas, matplotlib, numpy, scipy
- Capable of processing large datasets
- Advanced filtering, FFT analysis, custom visualizations
- Example workflow:
  ```python
  import pandas as pd
  import matplotlib.pyplot as plt
  
  # Load data
  data = pd.read_csv('ride_data.csv')
  
  # Plot pitch angle over time
  plt.plot(data['Timestamp'], data['Pitch'])
  plt.xlabel('Time')
  plt.ylabel('Pitch (degrees)')
  plt.title('Road Grade Analysis')
  plt.show()
  ```

**Option 3: MATLAB**
- Professional-grade analysis
- Excellent for signal processing and visualization
- Requires license (expensive)

#### Key Analysis Techniques

1. **Traction Circle Plot**: Plot lateral vs. longitudinal G-forces to visualize cornering dynamics
2. **Grade Analysis**: Convert pitch to grade percentage for climb/descent analysis
3. **Vibration Analysis**: FFT of vertical acceleration to identify resonant frequencies
4. **Cornering Analysis**: Extract maximum lean angles, entry/exit speeds
5. **Braking Analysis**: Identify hard braking events, measure deceleration rates
6. **Ride Smoothness**: Calculate standard deviation of accelerations for different road surfaces

### 5.6 Troubleshooting Common Issues

| Problem | Possible Causes | Solutions |
|---------|----------------|-----------|
| No data logging | SD card not formatted properly | Format as FAT32, check wiring |
| Corrupted data files | Power loss during write operation | Implement proper shutdown procedure |
| Sensor data freezes | I2C bus error | Check pull-up resistors, reduce wire length |
| Inaccurate timestamps | RTC not initialized | Set RTC time, verify backup battery |
| Short battery life | High sampling rate, inefficient code | Reduce sample rate, optimize firmware |
| Mount breaks off | Poor layer adhesion, wrong orientation | Increase infill, reorient print, use PETG |
| Data shows incorrect orientation | Sensor mounted incorrectly | Verify sensor axes, update firmware calibration |

---

## Conclusion and Future Enhancements

### Project Summary

This report has detailed a complete development plan for a compact cycling IMU data logger. The project encompasses careful component selection (ESP32 microcontroller and 9-DOF IMU), structured hardware prototyping, firmware architecture for high-resolution data capture, and mechanical design for durable field deployment. The final product captures multi-axis motion data at configurable sampling rates, stores it to removable media for post-ride analysis, and provides comprehensive insights into cycling dynamics that are impossible to obtain from standard cycling computers.

### Future Enhancements

The completed project serves as a robust platform for numerous potential enhancements:

#### 1. Wireless Data Transfer
- **Implementation**: Add Wi-Fi or Bluetooth file transfer capability
- **Benefit**: Download data without removing SD card or opening enclosure
- **Technology**: ESP32 web server or BLE file transfer protocol

#### 2. Real-Time Display Integration
- **Implementation**: Add small OLED display showing live sensor values
- **Benefit**: Immediate feedback during ride without post-processing
- **Display Options**: Current G-forces, lean angle, or battery status

#### 3. Hybrid Mode: Logging + BLE Streaming
- **Implementation**: Simultaneously log to SD card and stream subset of data via BLE
- **Benefit**: Real-time monitoring on cycling computer while maintaining high-resolution log
- **Challenges**: Increased power consumption, firmware complexity

#### 4. GPS Integration
- **Implementation**: Add GPS module for position/velocity data
- **Benefit**: Automatic timestamp synchronization, geospatial analysis
- **Hardware**: U-blox NEO series GPS modules with I2C interface

#### 5. Advanced Power Management
- **Implementation**: Add accelerometer interrupt-based wake-on-motion
- **Benefit**: Device automatically starts logging when riding begins, sleeps when stationary
- **Power Savings**: Weeks of standby time between rides

#### 6. Environmental Sensors
- **Implementation**: Add temperature, humidity, barometric pressure sensors
- **Benefit**: Correlate performance with environmental conditions
- **Hardware**: BME280 or BME680 breakout boards

#### 7. Machine Learning Integration
- **Implementation**: Train ML model to automatically classify ride segments
- **Benefit**: Automatic detection of climbs, descents, sprints, cornering events
- **Tools**: TensorFlow Lite for embedded inference

#### 8. Multi-Bike Mounting System
- **Implementation**: Design modular mount system for multiple bikes
- **Benefit**: Quick transfer between bikes without tools
- **Design**: Magnetic or quick-release mechanical interface

#### 9. Waterproof Enclosure Design
- **Implementation**: Add O-ring seals and conformal coating to electronics
- **Benefit**: All-weather operation without risk of water damage
- **Rating Target**: IP67 (submersion resistant)

#### 10. Companion Mobile App
- **Implementation**: Develop iOS/Android app for configuration and quick data preview
- **Benefit**: User-friendly interface for non-technical users
- **Features**: Data visualization, ride statistics, settings adjustment

---

## Appendices

### Appendix A: Complete Bill of Materials (BOM)

| Component | Quantity | Description | Approx. Price | Example Supplier |
|-----------|----------|-------------|---------------|------------------|
| Adafruit Feather ESP32 V2 | 1 | Microcontroller board | $20 | Adafruit |
| Adafruit BNO055 | 1 | 9-DOF IMU sensor | $35 | Adafruit |
| MicroSD Card Breakout | 1 | SD card interface | $15 | Adafruit/SparkFun |
| MicroSD Card (16GB) | 1 | Data storage | $8 | Amazon |
| DS3231 RTC Module | 1 | Real-time clock (optional) | $5 | Amazon |
| CR1220 Battery | 1 | RTC backup battery | $2 | Amazon |
| LiPo Battery (1000mAh) | 1 | Main power source | $10 | Adafruit |
| STEMMA QT Cables | 2 | I2C connections | $2 each | Adafruit |
| M2 Screws & Standoffs | 1 set | PCB mounting | $8 | Amazon |
| PETG Filament (1kg) | 1 | 3D printing material | $25 | Amazon |
| Male Pin Headers | 2 | Breadboard prototyping | $5 | Adafruit |
| **Total** | | | **~$135-160** | |

### Appendix B: Additional IMU Data Logger Considerations

#### B.1 Sampling Rate Selection Guidelines

The choice of sampling rate depends on the phenomena you wish to capture:

| Phenomenon | Minimum Sample Rate | Recommended Sample Rate | Rationale |
|------------|-------------------|----------------------|-----------|
| Road grade changes | 1 Hz | 5-10 Hz | Grade changes slowly over seconds |
| Cornering lean angle | 5 Hz | 20 Hz | Capture entry/exit dynamics |
| Braking events | 10 Hz | 50 Hz | Detect rapid deceleration onset |
| Road surface quality | 20 Hz | 50-100 Hz | Capture vibration frequencies |
| Pedaling cadence (indirect) | 2 Hz | 10 Hz | Typical cadence 60-100 RPM |

**Nyquist Theorem**: To capture a frequency component, sample at least 2× that frequency. For vibrations up to 25 Hz, sample at ≥50 Hz.

#### B.2 Data Volume Calculations

Estimate storage requirements for ride planning:

**CSV Format**:
- Approximate bytes per sample: 150-200 bytes (including timestamp and all sensor data)
- Samples per hour at 20 Hz: 72,000
- Storage per hour: ~14 MB
- 16 GB card capacity: ~1,100 hours of riding

**Binary Format**:
- Approximate bytes per sample: 50-60 bytes (raw binary values)
- Samples per hour at 50 Hz: 180,000
- Storage per hour: ~10 MB
- 16 GB card capacity: ~1,600 hours of riding

**Conclusion**: Even modest SD cards provide enormous capacity for multi-year data collection.

#### B.3 Sensor Calibration Best Practices

The BNO055 requires periodic calibration for accurate orientation:

**Calibration Procedure** (perform before each ride):
1. **Gyroscope**: Place device on stable surface for 2-3 seconds
2. **Accelerometer**: Move device through various orientations (6 positions: all faces up)
3. **Magnetometer**: Move device in figure-8 pattern away from metal objects

**Calibration Status Logging**:
- Log calibration status values (0-3 for each sensor) in data file
- Quality assurance: flag data segments with poor calibration
- Post-processing: filter or interpolate through uncalibrated segments

**Environmental Considerations**:
- Magnetometer highly sensitive to ferromagnetic interference (bike frame, motor vehicles)
- Accelerometer affected by vibration during calibration
- Gyroscope requires stable thermal environment

#### B.4 Coordinate System Conventions

**BNO055 Default Coordinate System**:
- X-axis: Forward (in direction of device face)
- Y-axis: Right (perpendicular to X in plane of device)
- Z-axis: Down (perpendicular to device, right-hand rule)

**Bicycle Coordinate System (SAE J670)**:
- X-axis: Forward (direction of travel)
- Y-axis: Right (parallel to ground when upright)
- Z-axis: Down (toward ground)

**Mounting Recommendations**:
- Mount sensor with its X-axis aligned with bicycle forward direction
- Document orientation in enclosure design and firmware comments
- Consider using rotation matrix if non-standard mounting required

#### B.5 Signal Processing for Enhanced Data Quality

**Moving Average Filter**:
- Reduces high-frequency noise
- Window size: 3-10 samples (balance between smoothness and lag)
- Best for: Grade calculations, slow-changing values

**Kalman Filter** (Advanced):
- Optimal state estimation combining multiple sensors
- Requires state space model and noise characterization
- Best for: Fusing GPS and IMU data, velocity estimation

**Low-Pass Filter**:
- Remove vibrations above frequency of interest
- Butterworth or Chebyshev designs
- Best for: Eliminating road buzz from orientation data

**High-Pass Filter**:
- Isolate transient events from steady-state values
- Best for: Detecting impacts, potholes, harsh braking

#### B.6 Multi-Device Synchronization

For advanced analysis, synchronize IMU data with other cycling sensors:

**GPS Cycling Computer**:
- Export GPX or FIT file from head unit
- Match timestamps between files
- Tools: Python gpxpy library, FIT SDK

**Power Meter**:
- Critical for correlating grade with power output
- Most power meters log at 1 Hz (downsample IMU data to match)

**Heart Rate Monitor**:
- Understand physiological response to terrain and efforts
- Synchronize via timestamps in FIT files

**Video Camera** (GoPro, Insta360):
- Visual verification of logged events
- Sync via "clap" marker at ride start (visible in both video and accelerometer data)

#### B.7 Post-Ride Data Analysis Checklist

After each ride, perform these validation steps:

1. ✅ **File Integrity**: Verify CSV opens without errors, correct number of columns
2. ✅ **Timestamp Continuity**: Check for gaps indicating logging interruptions
3. ✅ **Sensor Range Check**: Verify values within expected ranges (e.g., ±2g for normal riding)
4. ✅ **Calibration Status**: Review calibration throughout ride
5. ✅ **Battery Voltage**: Confirm no low-voltage events occurred
6. ✅ **Ride Duration**: Matches expected ride time
7. ✅ **Visual Inspection**: Plot key parameters to identify anomalies

#### B.8 Safety and Legal Considerations

**Device Mounting Safety**:
- Ensure mount does not interfere with steering, braking, or pedaling
- Verify device cannot detach during riding
- Consider using safety tether for high-value components

**Data Privacy**:
- IMU data alone is not personally identifiable
- Combined with GPS creates location tracking (privacy concern)
- Consider anonymization if sharing data publicly

**Distraction Risk**:
- Do not interact with device while riding
- Set configuration before ride begins
- Status LEDs should be subtle, not attention-grabbing

### Appendix C: 3D Model File Repository Link

*[To be populated with link to public repository containing .f3d source files, .step interchange files, and .stl print files]*

Recommended platforms:
- **Printables.com**: Free, maker-focused, good community
- **GitHub**: Version control, ideal for iterative designs
- **Thingiverse**: Large user base, established platform

### Appendix D: References and Further Reading

#### Sensor Fusion and IMU Theory
- "Visualizing Quaternions" by Andrew J. Hanson (textbook)
- "Inertial Navigation Systems" by Sebastian Madgwick (thesis)
- Adafruit BNO055 Datasheet and Application Notes

#### Data Analysis and Signal Processing
- "Python for Data Analysis" by Wes McKinney
- "The Scientist and Engineer's Guide to Digital Signal Processing" by Steven W. Smith (free online)
- SciPy documentation for signal processing functions

#### Cycling Performance Analysis
- "Training and Racing with a Power Meter" by Hunter Allen and Andrew Coggan
- Cycling Analytics forums and blog posts
- Strava and TrainingPeaks data analysis guides

#### Embedded Systems Development
- "Arduino Workshop" by John Boxall
- ESP32 Technical Reference Manual (Espressif Systems)
- "Making Embedded Systems" by Elecia White

### Appendix E: Version 2.0 Enhancement Roadmap

This appendix outlines three key enhancements for a future version of the IMU data logger: physical control buttons, multi-color status indication, and an integrated aerodynamic form factor matching the Coros Dura aesthetic. These features improve usability and appearance beyond the proof-of-concept.

#### E.1 Physical Control Buttons

**Purpose**: Enable field operation without USB connection.

**Implementation**:

**Button 1: Power Button**
- Short press: Check battery status (LED feedback)
- Long press (2s): Power on/off
- Hardware: 6×6mm tactile pushbutton connected to GPIO with pull-up resistor

**Button 2: Record Button**
- Short press: Start/stop logging (toggle)
- Long press (3s): Mark event in log file (creates timestamp marker for later analysis)
- Hardware: 6×6mm tactile pushbutton connected to separate GPIO

**Enclosure Integration**:
- Mount buttons on side of enclosure with cutouts for access
- Use waterproof tactile switches with rubber caps
- Consider recessed mounting to prevent accidental activation

**Code Example** (using OneButton library for debouncing):
```cpp
#include <OneButton.h>

OneButton powerBtn(POWER_BTN_PIN, true);
OneButton recordBtn(RECORD_BTN_PIN, true);

void setup() {
  powerBtn.attachClick(checkBattery);
  powerBtn.attachLongPressStart(powerOff);
  recordBtn.attachClick(toggleRecording);
  recordBtn.attachLongPressStart(markEvent);
}
```

#### E.2 Multi-Color RGB Status LED

**Purpose**: Provide clear visual feedback for device state (the Feather's single red LED is insufficient).

**Hardware**: WS2812B "NeoPixel" RGB LED
- Connects to single data pin on ESP32
- Cost: ~$0.75
- Power draw: 1-5mA at low brightness (negligible impact on battery)

**Status Color Scheme**:

| Status | Color | Pattern |
|--------|-------|---------|
| Ready (not recording) | Blue | Slow breathing |
| Recording active | Green | Double blink every 2s |
| Charging | Orange | Pulsing |
| Low battery (<20%) | Red | Fast blink |
| SD card error | Red | SOS pattern (· · · — — —) |
| Event marker | White | Brief flash |

**Enclosure Integration**:
- Add light pipe in enclosure lid as described in Section 4.3.2
- 3mm diameter vertical cylinder from LED position to exterior surface
- Flared cone at top (3mm → 5mm) for visibility
- Use clear or natural PETG for better light transmission

#### E.3 Integrated Aero Form Factor

**Purpose**: Match Coros Dura aesthetic and reduce aerodynamic drag.

**Design Approach**:

**Visual Integration**:
- Maintain same 60.8mm width as Coros Dura for alignment
- Match corner radii and surface curvature
- Print in black PETG or ASA for color matching
- Optional: vapor smoothing (ASA) or spray coating for premium finish

**Aerodynamic Profile**:
- Rounded leading edge (5-10mm radius)
- Gradual taper from max height to trailing edge
- Kamm tail (truncated taper) to reduce wake
- Example: NACA airfoil cross-section

**Side View Profile**:
```
        ╭───────────────╮       ← Rounded nose
       ╱                 ╲
      │   Electronics     │     ← Max height at mid-section
       ╲                 ╱
        ╰───────────────╯       ← Tapered tail
```

**Quarter-Turn Mount Integration**:
- Use generative design (Section 4.4) to create organic structural ribs
- Seamless integration: mount lugs emerge from sculpted recesses
- Single-piece construction with no visible joints

**Implementation Note**: Focus on form language matching rather than extreme aero optimization—the visual integration with Coros Dura is more important than marginal drag reduction for this use case

#### E.4 Wireless Data Transfer

**Purpose**: Eliminate the need to physically remove SD card for data download.

**MVP Limitation**: The Feather ESP32 V2 cannot present the SD card as USB mass storage when plugged into USB-C. The USB port only supports charging and serial communication, not file transfer. Therefore, the MVP requires physically removing the SD card and using a computer's card reader.

**V2 Solution: WiFi File Transfer (Primary Method)**

**Implementation**: ESP32 creates a web server that allows browsing and downloading files from SD card.

**User workflow:**
1. Return from ride, device still logging
2. Device creates WiFi access point (or joins home network)
3. Connect smartphone/computer to device's WiFi network
4. Open web browser, navigate to device IP (e.g., `http://192.168.4.1`)
5. Web interface shows list of ride files with timestamps and sizes
6. Click to download desired files
7. Files transfer wirelessly to phone/computer

**Basic code structure:**
```cpp
#include <WiFi.h>
#include <WebServer.h>
#include <SD.h>

WebServer server(80);

void setup() {
  // ... sensor initialization ...
  
  // Create WiFi access point
  WiFi.softAP("IMU_Logger", "password123");
  
  // Setup web server routes
  server.on("/", handleRoot);           // File list page
  server.on("/download", handleDownload); // File download
  server.begin();
}

void handleRoot() {
  String html = "<h1>IMU Logger Files</h1><ul>";
  
  File root = SD.open("/");
  File file = root.openNextFile();
  while (file) {
    html += "<li><a href='/download?file=" + String(file.name()) + "'>";
    html += String(file.name()) + " (" + String(file.size() / 1024) + " KB)</a></li>";
    file = root.openNextFile();
  }
  html += "</ul>";
  
  server.send(200, "text/html", html);
}
```

**Advantages:**
- No need to open enclosure or remove SD card
- Download files from phone or laptop
- Can preview file list before downloading
- Delete old files remotely to free space

**Power consumption:** WiFi active draws ~80-150mA additional (only enable when needed, disabled during rides)

**V2 Alternative: Bluetooth File Transfer**

**Implementation**: Use Bluetooth Serial (SPP) or BLE file transfer protocol.

**Characteristics:**
- Slower transfer than WiFi (~1-3 MB/min vs ~10-50 MB/min)
- Lower power consumption than WiFi (~20-40mA)
- Better for small file transfers or file list browsing
- Requires custom smartphone app or terminal program

**Use case:** Check battery status, preview latest file, or download small data samples without opening enclosure.

**V2 Fallback: USB-C Serial File Transfer**

**Implementation**: Custom protocol over USB serial connection for file transfer.

**Workflow:**
1. Plug in USB-C cable
2. Run Python script on computer
3. Script communicates over serial port to list/download files
4. Files transferred via serial at ~1-2 MB/min

**Example Python script:**
```python
import serial
import time

ser = serial.Serial('/dev/ttyUSB0', 115200)

# Request file list
ser.write(b'LIST\n')
time.sleep(0.5)
files = ser.read_all().decode()
print(files)

# Download specific file
ser.write(b'DOWNLOAD ride_20251021_143022.csv\n')
data = ser.read_all()
with open('downloaded_ride.csv', 'wb') as f:
    f.write(data)
```

**Advantages over SD removal:**
- No need to open enclosure
- Can be automated with scripts
- Works with any computer (no WiFi network needed)

**Disadvantages:**
- Requires custom firmware and PC software
- Slower than WiFi
- Still requires USB cable

**Recommendation Order for V2:**
1. **Primary**: WiFi web server (fastest, most convenient)
2. **Secondary**: Bluetooth (for quick checks without WiFi)
3. **Fallback**: USB-C serial transfer (when WiFi unavailable)
4. **Last resort**: Physical SD card removal (always works)

---

## Summary of Key Engineering Principles

This project exemplifies several fundamental engineering practices applicable beyond this specific application:

### 1. Incremental Development and Validation
Systematic testing at each stage (sensor verification → breadboard prototype → firmware development → integration) isolates failures and prevents cascading issues.

### 2. Understanding Abstraction Layers
While convenient integrated features (STEMMA QT connectors, sensor fusion) simplify development, understanding underlying principles (I2C pull-ups, quaternion mathematics) is essential for troubleshooting and adaptation.

### 3. Design for Manufacturability
Accounting for real-world constraints (3D printer tolerances, material properties, assembly access) transforms CAD models into functional products.

### 4. Power Budget Analysis
Battery life is determined by systematic analysis of current consumption in each operational mode, not wishful thinking or guesswork.

### 5. Signal Processing for Data Quality
Raw sensor data rarely provides directly usable insights; filtering, calibration, and proper sampling are essential for extracting meaningful information.

### 6. Standards Adoption
Leveraging industry standards (Garmin mount, FAT32 file system, CSV format) ensures compatibility and reduces development burden.

### 7. Documentation and Reproducibility
Complete documentation (BOM, schematic, code comments, assembly instructions) enables others to replicate, validate, and improve upon your work—the hallmark of engineering excellence.

---

**End of Development Plan**

