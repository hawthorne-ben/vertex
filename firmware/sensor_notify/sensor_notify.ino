/*
 * Vertex Sensor Notify - Minimal Test Version
 *
 * Based on working bno055_dual_mode implementation
 * Boot + sensor init + basic BLE
 */

#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BNO055.h>
#include <utility/imumaths.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "esp_log.h"

// BLE UUIDs
#define SERVICE_UUID        "12345678-1234-5678-1234-56789abcdef0"
#define SENSOR_CHAR_UUID    "12345678-1234-5678-1234-56789abcdef1"

// Forward declarations
void sendSensorData();

// Create BNO055 sensor instance
Adafruit_BNO055 bno = Adafruit_BNO055(55);

// BLE objects
BLEServer* pServer = nullptr;
BLEService* pService = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
unsigned long connectionTime = 0;
const unsigned long CONNECTION_STABILIZE_MS = 1000; // Wait 1s after connection

// LED
#define LED_PIN 13

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
const unsigned long SAMPLE_INTERVAL_MS = 100;  // 10 Hz - optimized for stability
unsigned long lastBatteryReadTime = 0;
const unsigned long BATTERY_READ_INTERVAL_MS = 1000;  // Read battery once per second

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

void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("  Vertex Sensor Notify - MINIMAL TEST");
  Serial.println("========================================\n");

  // Initialize LED
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  // Disable I2C logging noise BEFORE sensor init
  Serial.println("[SETUP] Suppressing I2C logs...");
  esp_log_level_set("i2c", ESP_LOG_NONE);

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

  // Create BLE Characteristic
  pCharacteristic = pService->createCharacteristic(
    SENSOR_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  Serial.println("[BLE] Characteristic created");

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

  digitalWrite(LED_PIN, LOW);
}

void loop() {
  unsigned long loopStart = micros();
  unsigned long now = millis();

  // Update sensor data and send notifications every 1 second when connected
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    updateSensorData();

    // Auto-send notification if connected (don't wait for read requests)
    if (deviceConnected && (now - connectionTime >= CONNECTION_STABILIZE_MS)) {
      sendSensorData();
    }

    lastSampleTime = now;
    perfMetrics.sampleCount++;
  }

  // Blink LED - fast if connected, slow if disconnected
  static unsigned long lastBlink = 0;
  int blinkInterval = deviceConnected ? 100 : 1000;
  if (now - lastBlink > blinkInterval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = now;
  }

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

  // Read all sensor data
  imu::Vector<3> euler = bno.getVector(Adafruit_BNO055::VECTOR_EULER);
  imu::Vector<3> accel = bno.getVector(Adafruit_BNO055::VECTOR_ACCELEROMETER);
  imu::Vector<3> gyro = bno.getVector(Adafruit_BNO055::VECTOR_GYROSCOPE);
  imu::Vector<3> mag = bno.getVector(Adafruit_BNO055::VECTOR_MAGNETOMETER);

  // Read calibration
  uint8_t sys, gyro_cal, accel_cal, mag_cal;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);

  perfMetrics.sensorReadTime = micros() - start;

  // Update sensor data structure
  sensorData.timestamp = millis();

  // Euler angles (degrees)
  sensorData.roll = euler.x();
  sensorData.pitch = euler.y();
  sensorData.yaw = euler.z();

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
  float cpuUsage = (perfMetrics.loopTime / (float)SAMPLE_INTERVAL_MS / 1000.0) * 100.0;

  Serial.println("\n=== PERFORMANCE METRICS ===");
  Serial.printf("Sample Rate: %.1f Hz (target: %.0f Hz)\n", actualHz, 1000.0 / SAMPLE_INTERVAL_MS);
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
  Serial.printf("Available Time @10Hz: %.1f ms\n", (SAMPLE_INTERVAL_MS - (totalTime / 1000.0)));
  Serial.printf("Max Theoretical Hz: %.1f Hz (if zero overhead)\n", 1000000.0 / totalTime);
  Serial.println("==========================\n");

  perfMetrics.sampleCount = 0;
}
