/*
 * Vertex Sensor Notify - Minimal Test Version
 *
 * Based on working bno055_dual_mode implementation
 * Boot + sensor init + basic BLE
 * Power Control: BOOT button (GPIO0) for on/off
 *
 * Firmware Version: 0.1.0
 * VTX Format: v1.0
 */

// Version information
#define FIRMWARE_VERSION "0.1.0"
#define VTX_FORMAT_MAJOR 1
#define VTX_FORMAT_MINOR 0

#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "esp_log.h"
#include "esp_sleep.h"
#include "driver/gpio.h"

// BLE UUIDs
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define SENSOR_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef1"
#define CONFIG_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef2"

// Configuration commands
#define CMD_SET_SAMPLE_RATE 0x01
#define CMD_CALIBRATE       0x02
#define CMD_POWER_MODE      0x03
#define CMD_RESET           0x04
#define CMD_LED_MODE        0x05
#define CMD_QUERY_CONFIG    0xFF

// Forward declarations
void sendSensorData();

// Create BNO055 sensor instance
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// BLE objects
BLEServer* pServer = nullptr;
BLEService* pService = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
BLECharacteristic* pConfigCharacteristic = nullptr;
bool deviceConnected = false;
unsigned long connectionTime = 0;
const unsigned long CONNECTION_STABILIZE_MS = 1000; // Wait 1s after connection

// LED
#define LED_PIN 13

// User button (GPIO38) - button next to Neopixel LED on Feather ESP32 V2
// Hold for 500ms to power off, press again to wake from sleep
#define USER_BUTTON_PIN 38

// Battery monitoring (ESP32 Feather V2 has battery voltage on A13/GPIO35)
#define BATTERY_PIN 35
#define BATTERY_VOLTAGE_DIVIDER 2.0  // Feather has 2:1 voltage divider

// Current sensor data
struct SensorData {
  unsigned long timestamp;
  float roll, pitch, yaw;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
  float mag_x, mag_y, mag_z;
  uint8_t cal_sys, cal_gyro, cal_accel, cal_mag;
  float battery_voltage;
} sensorData;

unsigned long lastSampleTime = 0;
unsigned long sampleIntervalMs = 100;  // 10 Hz default - configurable via BLE
unsigned long lastBatteryReadTime = 0;
const unsigned long BATTERY_READ_INTERVAL_MS = 1000;  // Read battery once per second

// Device configuration (can be changed via BLE)
struct DeviceConfig {
  uint8_t powerMode;     // 0=low, 1=normal, 2=high performance
  uint8_t ledMode;       // 0=off, 1=status, 2=always-on
  bool autoCalibrate;    // Auto-calibration enabled
} deviceConfig = {1, 1, false};  // Default: normal power, status LED, no auto-cal

// Performance profiling
struct PerformanceMetrics {
  unsigned long sensorReadTime;    // microseconds
  unsigned long bleNotifyTime;     // microseconds
  unsigned long loopTime;          // microseconds
  unsigned long maxLoopTime;       // microseconds
  float cpuTemp;                   // Celsius
  unsigned long sampleCount;
} perfMetrics = {0, 0, 0, 0, 0.0, 0};

unsigned long lastPerfReportTime = 0;
const unsigned long PERF_REPORT_INTERVAL_MS = 5000;  // Report every 5 seconds

// BLE Server Callbacks
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    connectionTime = millis();
    // Reset timing to ensure consistent sample rate on reconnection
    lastSampleTime = millis();
    lastBatteryReadTime = millis();
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    connectionTime = 0;
    BLEDevice::startAdvertising();
  }
};

// BLE Characteristic Callbacks - send data when read
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) {
    sendSensorData();
  }
};

// BLE Config Characteristic Callbacks - handle configuration commands
class MyConfigCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    String value = pCharacteristic->getValue();

    if (value.length() < 1) {
      Serial.println("[CONFIG] Empty command received");
      return;
    }

    uint8_t cmd = (uint8_t)value[0];
    Serial.printf("[CONFIG] Command received: 0x%02X\n", cmd);

    switch(cmd) {
      case CMD_SET_SAMPLE_RATE: {
        if (value.length() >= 5) {
          uint32_t intervalMs;
          memcpy(&intervalMs, value.c_str() + 1, 4);

          // Validate range: 20ms (50Hz) to 1000ms (1Hz)
          if (intervalMs >= 20 && intervalMs <= 1000) {
            sampleIntervalMs = intervalMs;
            Serial.printf("[CONFIG] Sample rate set to %lu ms (%.1f Hz)\n",
                          sampleIntervalMs, 1000.0 / sampleIntervalMs);
          } else {
            Serial.printf("[CONFIG] Invalid interval: %lu ms (must be 20-1000)\n", intervalMs);
          }
        }
        break;
      }

      case CMD_CALIBRATE: {
        Serial.println("[CONFIG] Manual calibration triggered");
        // Force sensor re-read to update calibration status
        uint8_t sys, gyro_cal, accel_cal, mag_cal;
        bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);
        Serial.printf("[CONFIG] Calibration status: SYS=%d GYRO=%d ACCEL=%d MAG=%d\n",
                      sys, gyro_cal, accel_cal, mag_cal);
        break;
      }

      case CMD_POWER_MODE: {
        if (value.length() >= 2) {
          uint8_t mode = value[1];
          if (mode <= 2) {
            deviceConfig.powerMode = mode;
            const char* modeNames[] = {"LOW", "NORMAL", "HIGH"};
            Serial.printf("[CONFIG] Power mode set to: %s\n", modeNames[mode]);

            // Adjust I2C speed based on power mode
            switch(mode) {
              case 0: Wire.setClock(100000); break;  // 100kHz - low power
              case 1: Wire.setClock(400000); break;  // 400kHz - normal
              case 2: Wire.setClock(400000); break;  // 400kHz - high (same speed, different sampling)
            }
          }
        }
        break;
      }

      case CMD_RESET: {
        Serial.println("[CONFIG] Soft reset triggered");
        delay(100);
        ESP.restart();
        break;
      }

      case CMD_LED_MODE: {
        if (value.length() >= 2) {
          uint8_t mode = value[1];
          if (mode <= 2) {
            deviceConfig.ledMode = mode;
            const char* modeNames[] = {"OFF", "STATUS", "ALWAYS-ON"};
            Serial.printf("[CONFIG] LED mode set to: %s\n", modeNames[mode]);

            if (mode == 0) {
              digitalWrite(LED_PIN, LOW);  // Turn off immediately
            } else if (mode == 2) {
              digitalWrite(LED_PIN, HIGH);  // Turn on immediately
            }
          }
        }
        break;
      }

      case CMD_QUERY_CONFIG: {
        Serial.println("[CONFIG] Configuration query:");
        Serial.printf("  Sample Rate: %lu ms (%.1f Hz)\n",
                      sampleIntervalMs, 1000.0 / sampleIntervalMs);
        Serial.printf("  Power Mode: %d\n", deviceConfig.powerMode);
        Serial.printf("  LED Mode: %d\n", deviceConfig.ledMode);
        Serial.printf("  Firmware: %s\n", FIRMWARE_VERSION);
        Serial.printf("  VTX Format: v%d.%d\n", VTX_FORMAT_MAJOR, VTX_FORMAT_MINOR);

        // Send response back (optional - app can read if needed)
        uint8_t response[16];
        response[0] = CMD_QUERY_CONFIG;
        memcpy(response + 1, &sampleIntervalMs, 4);
        response[5] = deviceConfig.powerMode;
        response[6] = deviceConfig.ledMode;
        response[7] = deviceConfig.autoCalibrate;
        pCharacteristic->setValue(response, 8);
        pCharacteristic->notify();
        break;
      }

      default:
        Serial.printf("[CONFIG] Unknown command: 0x%02X\n", cmd);
        break;
    }
  }
};

void setup() {
  Serial.begin(115200);
  delay(1000);
  
  // Disable I2C logging noise IMMEDIATELY to suppress error logs
  esp_log_level_set("i2c", ESP_LOG_NONE);
  esp_log_level_set("i2c.master", ESP_LOG_NONE);
  esp_log_level_set("i2c.slave", ESP_LOG_NONE);
  esp_log_level_set("i2c_main", ESP_LOG_NONE);
  // Suppress all ESP-IDF error logs
  esp_log_level_set("*", ESP_LOG_WARN);  // Only show warnings and above

  // Configure user button (GPIO38) - the power off button
  pinMode(USER_BUTTON_PIN, INPUT);
  delay(10);
  
  // Check if we're waking from deep sleep
  esp_sleep_wakeup_cause_t wakeup_reason;
  wakeup_reason = esp_sleep_get_wakeup_cause();
  
  if (wakeup_reason != ESP_SLEEP_WAKEUP_UNDEFINED) {
    // Woke from some sleep mode
    Serial.println("\n========================================");
    Serial.println("  Vertex Sensor Notify - WOKE FROM SLEEP");
    Serial.println("========================================");
    
    // Add extra delay for I2C to stabilize after deep sleep
    Serial.println("[POWER] Stabilizing I2C after deep sleep...");
    delay(500);
  } else {
    // Fresh boot or reset
    Serial.println("\n========================================");
    Serial.println("  Vertex Sensor Notify - MINIMAL TEST");
    Serial.println("========================================");
  }

  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // Initialize sensor
  Serial.print("[SETUP] Initializing sensor...");
  Wire.begin();
  Wire.setClock(400000);  // 400kHz for higher throughput
  Wire.setTimeout(1000);

  if (!bno.begin()) {
    Serial.println(" ERROR!");
    Serial.println("[ERROR] BNO055 not found. Check connections.");
    while (1) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      delay(100);
    }
  }

  bno.setExtCrystalUse(true);
  Serial.println(" OK");
  delay(500);

  // Initialize BLE
  Serial.println("[SETUP] Initializing BLE...");
  BLEDevice::init("Vertex-IMU");
  Serial.println("[BLE] Device initialized");

  // Create BLE Server
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  Serial.println("[BLE] Server created");

  // Create BLE Service
  pService = pServer->createService(SERVICE_UUID);
  Serial.println("[BLE] Service created");

  // Create BLE Sensor Characteristic (read/notify)
  pCharacteristic = pService->createCharacteristic(
    SENSOR_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  Serial.println("[BLE] Sensor characteristic created");

  // Create BLE Config Characteristic (write)
  pConfigCharacteristic = pService->createCharacteristic(
    CONFIG_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  pConfigCharacteristic->setCallbacks(new MyConfigCallbacks());
  Serial.println("[BLE] Config characteristic created");

  // Start the service
  pService->start();
  Serial.println("[BLE] Service started");

  // Start advertising
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising started");

  String address = BLEDevice::getAddress().toString().c_str();
  Serial.print("[BLE] Device address: ");
  Serial.println(address);

  Serial.println("\n========================================");
  Serial.println("Ready!");
  Serial.println("========================================\n");

  // Reset timing variables to prevent carryover from previous sessions
  lastSampleTime = millis();
  lastBatteryReadTime = millis();
  lastPerfReportTime = millis();

  digitalWrite(LED_PIN, LOW);
}

void loop() {
  unsigned long loopStart = micros();
  unsigned long now = millis();

  // Check for power button press (USER button - GPIO38)
  // Any press immediately enters deep sleep
  static unsigned long lastButtonCheck = 0;
  
  if (now - lastButtonCheck > 10) {  // Check every 10ms
    bool currentButtonState = digitalRead(USER_BUTTON_PIN);
    
    if (currentButtonState == LOW) {  // Button is pressed
      Serial.println("\n[POWER] Button pressed - entering deep sleep");
      Serial.println("[POWER] Press RESET button to wake\n");
      digitalWrite(LED_PIN, LOW);
      
      // Enter deep sleep with NO wake source
      // Only hardware reset will wake the device
      esp_deep_sleep_start();
    }
    
    lastButtonCheck = now;
  }

  // Update sensor data and send notifications at configured rate when connected
  if (now - lastSampleTime >= sampleIntervalMs) {
    updateSensorData();
    lastSampleTime = now;
    perfMetrics.sampleCount++;

    // Auto-send notification if connected (don't wait for read requests)
    if (deviceConnected && (now - connectionTime >= CONNECTION_STABILIZE_MS)) {
      sendSensorData();
    }
  }

  // Blink LED based on LED mode configuration
  static unsigned long lastBlink = 0;
  if (deviceConfig.ledMode == 1) {  // Status mode
    int blinkInterval = deviceConnected ? 100 : 1000;
    if (now - lastBlink > blinkInterval) {
      digitalWrite(LED_PIN, !digitalRead(LED_PIN));
      lastBlink = now;
    }
  }
  // ledMode 0 (off) and 2 (always-on) are handled in the config callback

  // Track loop timing
  unsigned long loopEnd = micros();
  perfMetrics.loopTime = loopEnd - loopStart;
  if (perfMetrics.loopTime > perfMetrics.maxLoopTime) {
    perfMetrics.maxLoopTime = perfMetrics.loopTime;
  }

  // Report performance metrics every 5 seconds
  if (now - lastPerfReportTime >= PERF_REPORT_INTERVAL_MS) {
    reportPerformance();
    lastPerfReportTime = now;
    perfMetrics.maxLoopTime = 0;  // Reset max after reporting
  }
}

void sendSensorData() {
  unsigned long start = micros();

  // Pack data into binary format (60 bytes total):
  // - timestamp (4 bytes)
  // - roll, pitch, yaw (12 bytes)
  // - accel_x, accel_y, accel_z (12 bytes)
  // - gyro_x, gyro_y, gyro_z (12 bytes)
  // - mag_x, mag_y, mag_z (12 bytes)
  // - calibration (4 bytes)
  // - battery_voltage (4 bytes)

  uint8_t buffer[60];
  int offset = 0;

  // Timestamp (4 bytes)
  memcpy(buffer + offset, &sensorData.timestamp, 4);
  offset += 4;

  // Euler angles (12 bytes)
  memcpy(buffer + offset, &sensorData.roll, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.pitch, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.yaw, 4);
  offset += 4;

  // Acceleration (12 bytes)
  memcpy(buffer + offset, &sensorData.accel_x, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.accel_y, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.accel_z, 4);
  offset += 4;

  // Gyroscope (12 bytes)
  memcpy(buffer + offset, &sensorData.gyro_x, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.gyro_y, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.gyro_z, 4);
  offset += 4;

  // Magnetometer (12 bytes)
  memcpy(buffer + offset, &sensorData.mag_x, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.mag_y, 4);
  offset += 4;
  memcpy(buffer + offset, &sensorData.mag_z, 4);
  offset += 4;

  // Calibration (4 bytes)
  buffer[offset++] = sensorData.cal_sys;
  buffer[offset++] = sensorData.cal_gyro;
  buffer[offset++] = sensorData.cal_accel;
  buffer[offset++] = sensorData.cal_mag;

  // Battery voltage (4 bytes)
  memcpy(buffer + offset, &sensorData.battery_voltage, 4);
  offset += 4;

  // Send notification
  pCharacteristic->setValue(buffer, 60);
  pCharacteristic->notify();

  perfMetrics.bleNotifyTime = micros() - start;
}

void updateSensorData() {
  unsigned long start = micros();

  // Read quaternion data (reliable at all angles, avoids gimbal lock)
  // BNO055 direct euler output is unreliable beyond 45° pitch/roll
  imu::Quaternion quat = bno.getQuat();

  // Convert quaternion to euler angles using library's toEuler() method
  // This avoids the BNO055 firmware's gimbal lock issues at steep angles
  imu::Vector<3> euler = quat.toEuler();

  // Read other sensor data
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  imu::Vector<3> mag = bno.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);

  // Read calibration
  uint8_t sys, gyro_cal, accel_cal, mag_cal;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);

  perfMetrics.sensorReadTime = micros() - start;

  // Update sensor data structure
  sensorData.timestamp = millis();

  // Euler angles from quaternion (convert radians to degrees)
  // toEuler() returns radians: x=heading/yaw, y=roll, z=pitch
  // Convert to degrees for BLE transmission (Android app expects degrees)
  sensorData.yaw = euler.x() * 180.0 / M_PI;    // Heading (0-360°)
  sensorData.roll = euler.y() * 180.0 / M_PI;   // Roll (-180 to +180°)
  sensorData.pitch = euler.z() * 180.0 / M_PI;  // Pitch (-90 to +90°)

  // Linear acceleration (m/s²)
  sensorData.accel_x = accel.x();
  sensorData.accel_y = accel.y();
  sensorData.accel_z = accel.z();

  // Angular velocity (rad/s)
  sensorData.gyro_x = gyro.x();
  sensorData.gyro_y = gyro.y();
  sensorData.gyro_z = gyro.z();

  // Magnetic field (uT)
  sensorData.mag_x = mag.x();
  sensorData.mag_y = mag.y();
  sensorData.mag_z = mag.z();

  // Calibration status
  sensorData.cal_sys = sys;
  sensorData.cal_gyro = gyro_cal;
  sensorData.cal_accel = accel_cal;
  sensorData.cal_mag = mag_cal;

  // Read battery voltage only once per second (not every sample)
  unsigned long now = millis();
  if (now - lastBatteryReadTime >= BATTERY_READ_INTERVAL_MS) {
    int adcValue = analogRead(BATTERY_PIN);
    sensorData.battery_voltage = (adcValue / 4095.0) * 3.3 * BATTERY_VOLTAGE_DIVIDER;
    lastBatteryReadTime = now;
  }
}

void reportPerformance() {
  // Read ESP32 internal temperature sensor
  perfMetrics.cpuTemp = temperatureRead();

  float actualHz = (perfMetrics.sampleCount * 1000.0) / PERF_REPORT_INTERVAL_MS;
  float cpuUsage = (perfMetrics.loopTime / (float)sampleIntervalMs / 1000.0) * 100.0;

  Serial.println("\n=== PERFORMANCE METRICS ===");
  Serial.printf("Sample Rate: %.1f Hz (target: %.0f Hz)\n", actualHz, 1000.0 / sampleIntervalMs);
  Serial.printf("Sensor I2C Read: %lu µs (%.1f ms)\n", perfMetrics.sensorReadTime, perfMetrics.sensorReadTime / 1000.0);
  Serial.printf("BLE Notify: %lu µs (%.1f ms)\n", perfMetrics.bleNotifyTime, perfMetrics.bleNotifyTime / 1000.0);
  Serial.printf("Loop Time: %lu µs (%.1f ms)\n", perfMetrics.loopTime, perfMetrics.loopTime / 1000.0);
  Serial.printf("Max Loop: %lu µs (%.1f ms)\n", perfMetrics.maxLoopTime, perfMetrics.maxLoopTime / 1000.0);
  Serial.printf("CPU Usage: %.1f%%\n", cpuUsage);
  Serial.printf("CPU Temp: %.1f°C\n", perfMetrics.cpuTemp);
  Serial.printf("Free Heap: %d bytes\n", ESP.getFreeHeap());

  // Calculate overhead and available headroom
  unsigned long totalTime = perfMetrics.sensorReadTime + perfMetrics.bleNotifyTime;
  Serial.printf("Total Overhead: %lu µs (%.1f ms)\n", totalTime, totalTime / 1000.0);
  Serial.printf("Available Time: %.1f ms\n", (sampleIntervalMs - (totalTime / 1000.0)));
  Serial.printf("Max Theoretical Hz: %.1f Hz (if zero overhead)\n", 1000000.0 / totalTime);
  Serial.println("==========================\n");

  perfMetrics.sampleCount = 0;
}

