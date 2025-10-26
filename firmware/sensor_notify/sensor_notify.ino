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

// Current sensor data
struct SensorData {
  unsigned long timestamp;
  float roll, pitch, yaw;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
  float mag_x, mag_y, mag_z;
  uint8_t cal_sys, cal_gyro, cal_accel, cal_mag;
} sensorData;

unsigned long lastSampleTime = 0;
const unsigned long SAMPLE_INTERVAL_MS = 1000;  // 1 Hz - reduced to prevent stack overflow
unsigned long lastBleUpdateTime = 0;
const unsigned long BLE_UPDATE_INTERVAL_MS = 1000;  // 1 Hz for BLE

// BLE Server Callbacks
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    deviceConnected = true;
    connectionTime = millis();
    Serial.println("[BLE] Client connected! Waiting 1s before sending data...");
  }

  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    connectionTime = 0;
    Serial.println("[BLE] Client disconnected!");
    Serial.println("[BLE] Restarting advertising...");
    BLEDevice::startAdvertising();
  }
};

// BLE Characteristic Callbacks - send data when read
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) {
    Serial.println("[BLE] Read request received, sending sensor data");
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
  Wire.setClock(100000);  // 100kHz for stability
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
  unsigned long now = millis();

  // Update sensor data and send notifications every 1 second when connected
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    updateSensorData();

    // Auto-send notification if connected (don't wait for read requests)
    if (deviceConnected && (now - connectionTime >= CONNECTION_STABILIZE_MS)) {
      sendSensorData();
    }

    lastSampleTime = now;
  }

  // Blink LED - fast if connected, slow if disconnected
  static unsigned long lastBlink = 0;
  int blinkInterval = deviceConnected ? 100 : 1000;
  if (now - lastBlink > blinkInterval) {
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
    lastBlink = now;
  }
}

void sendSensorData() {
  // Pack data into binary format (56 bytes total):
  // - timestamp (4 bytes)
  // - roll, pitch, yaw (12 bytes)
  // - accel_x, accel_y, accel_z (12 bytes)
  // - gyro_x, gyro_y, gyro_z (12 bytes)
  // - mag_x, mag_y, mag_z (12 bytes)
  // - calibration (4 bytes)

  Serial.println("[BLE] Sending notification...");

  uint8_t buffer[56];
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

  // Send notification
  pCharacteristic->setValue(buffer, 56);
  pCharacteristic->notify();
  Serial.println("[BLE] Notification sent!");
}

void updateSensorData() {
  // TEMPORARY: Only read euler angles to reduce stack usage
  // Reading all sensors causes stack overflow when sending via BLE
  imu::Vector<3> euler = bno.getVector(Adafruit_BNO055::VECTOR_EULER);

  // Read calibration (lightweight)
  uint8_t sys, gyro_cal, accel_cal, mag_cal;
  bno.getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);

  // Update structure - only orientation for now
  sensorData.timestamp = millis();
  sensorData.roll = euler.x();
  sensorData.pitch = euler.y();
  sensorData.yaw = euler.z();

  // Set other values to zero for now
  sensorData.accel_x = 0;
  sensorData.accel_y = 0;
  sensorData.accel_z = 0;
  sensorData.gyro_x = 0;
  sensorData.gyro_y = 0;
  sensorData.gyro_z = 0;
  sensorData.mag_x = 0;
  sensorData.mag_y = 0;
  sensorData.mag_z = 0;

  sensorData.cal_sys = sys;
  sensorData.cal_gyro = gyro_cal;
  sensorData.cal_accel = accel_cal;
  sensorData.cal_mag = mag_cal;

  // Print every sample (now at 1Hz)
  Serial.printf("[%lu] Roll=%.1f Pitch=%.1f Yaw=%.1f | Cal: S=%d G=%d A=%d M=%d | BLE: %s\n",
                sensorData.timestamp,
                sensorData.roll, sensorData.pitch, sensorData.yaw,
                sys, gyro_cal, accel_cal, mag_cal,
                deviceConnected ? "CONNECTED" : "advertising");
}
