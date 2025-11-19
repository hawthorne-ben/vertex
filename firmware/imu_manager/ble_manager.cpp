/*
 * BLE Manager Implementation
 * Handles all Bluetooth Low Energy communication
 */

#include "ble_manager.h"
#include "sensor_manager.h"

// External reference to sensor manager (for calibration command)
extern SensorManager sensorManager;

// Forward declare the global BLEManager instance for callbacks
BLEManager* g_bleManagerInstance = nullptr;

// ===== BLE Server Callbacks =====
class MyServerCallbacks: public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) {
    if (g_bleManagerInstance) {
      g_bleManagerInstance->deviceConnected = true;
      g_bleManagerInstance->connectionTime = millis();
    }
  }

  void onDisconnect(BLEServer* pServer) {
    if (g_bleManagerInstance) {
      g_bleManagerInstance->deviceConnected = false;
      g_bleManagerInstance->connectionTime = 0;
      g_bleManagerInstance->sampleIntervalMs = DEFAULT_SAMPLE_INTERVAL_MS;
    }
    BLEDevice::startAdvertising();
  }
};

// ===== BLE Characteristic Callbacks =====
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
  void onRead(BLECharacteristic* pCharacteristic) {
    // Data will be sent via notify, read is passive
  }
};

// ===== BLE Config Characteristic Callbacks =====
class MyConfigCallbacks: public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pCharacteristic) {
    if (!g_bleManagerInstance) return;

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

          if (intervalMs >= MIN_SAMPLE_INTERVAL_MS && intervalMs <= MAX_SAMPLE_INTERVAL_MS) {
            g_bleManagerInstance->sampleIntervalMs = intervalMs;
            Serial.printf("[CONFIG] Sample rate set to %lu ms (%.1f Hz)\n",
                          intervalMs, 1000.0 / intervalMs);
          } else {
            Serial.printf("[CONFIG] Invalid interval: %lu ms (must be %d-%d)\n",
                          intervalMs, MIN_SAMPLE_INTERVAL_MS, MAX_SAMPLE_INTERVAL_MS);
          }
        }
        break;
      }

      case CMD_CALIBRATE: {
        Serial.println("[CONFIG] Manual calibration triggered");
        uint8_t sys, gyro_cal, accel_cal, mag_cal;
        sensorManager.getBNO055().getCalibration(&sys, &gyro_cal, &accel_cal, &mag_cal);
        Serial.printf("[CONFIG] Calibration status: SYS=%d GYRO=%d ACCEL=%d MAG=%d\n",
                      sys, gyro_cal, accel_cal, mag_cal);
        break;
      }

      case CMD_POWER_MODE: {
        if (value.length() >= 2) {
          uint8_t mode = value[1];
          if (mode <= 2) {
            g_bleManagerInstance->deviceConfig.powerMode = mode;
            Serial.printf("[CONFIG] Power mode set to: %s\n", POWER_MODE_NAMES[mode]);

            // Adjust I2C speed based on power mode
            switch(mode) {
              case 0: Wire.setClock(I2C_CLOCK_SPEED_LOW); break;
              case 1: Wire.setClock(I2C_CLOCK_SPEED_NORMAL); break;
              case 2: Wire.setClock(I2C_CLOCK_SPEED_NORMAL); break;
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
            g_bleManagerInstance->deviceConfig.ledMode = mode;
            Serial.printf("[CONFIG] LED mode set to: %s\n", LED_MODE_NAMES[mode]);

            if (mode == 0) {
              digitalWrite(LED_PIN, LOW);
            } else if (mode == 2) {
              digitalWrite(LED_PIN, HIGH);
            }
          }
        }
        break;
      }

      case CMD_QUERY_CONFIG: {
        Serial.println("[CONFIG] Configuration query:");
        Serial.printf("  Sample Rate: %lu ms (%.1f Hz)\n",
                      g_bleManagerInstance->sampleIntervalMs,
                      1000.0 / g_bleManagerInstance->sampleIntervalMs);
        Serial.printf("  Power Mode: %d\n", g_bleManagerInstance->deviceConfig.powerMode);
        Serial.printf("  LED Mode: %d\n", g_bleManagerInstance->deviceConfig.ledMode);
        Serial.printf("  Firmware: %s\n", FIRMWARE_VERSION);
        Serial.printf("  VTX Format: v%d.%d\n", VTX_FORMAT_MAJOR, VTX_FORMAT_MINOR);

        // Send response back
        uint8_t response[16];
        response[0] = CMD_QUERY_CONFIG;
        memcpy(response + 1, &g_bleManagerInstance->sampleIntervalMs, 4);
        response[5] = g_bleManagerInstance->deviceConfig.powerMode;
        response[6] = g_bleManagerInstance->deviceConfig.ledMode;
        response[7] = g_bleManagerInstance->deviceConfig.autoCalibrate;
        g_bleManagerInstance->pCharacteristic->setValue(response, 8);
        g_bleManagerInstance->pCharacteristic->notify();
        break;
      }

      default:
        Serial.printf("[CONFIG] Unknown command: 0x%02X\n", cmd);
        break;
    }
  }
};

// ===== BLEManager Implementation =====

BLEManager::BLEManager()
  : pServer(nullptr),
    pService(nullptr),
    pCharacteristic(nullptr),
    pConfigCharacteristic(nullptr),
    deviceConnected(false),
    connectionTime(0),
    sampleIntervalMs(DEFAULT_SAMPLE_INTERVAL_MS),
    lastNotifyTime(0) {

  // Default device configuration
  deviceConfig.powerMode = 1;      // Normal power
  deviceConfig.ledMode = 1;        // Status LED
  deviceConfig.autoCalibrate = false;

  g_bleManagerInstance = this;
}

void BLEManager::init() {
  Serial.println("[SETUP] Initializing BLE...");
  BLEDevice::init(BLE_DEVICE_NAME);
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

  // Explicitly set the advertised name (critical for discovery!)
  BLEAdvertisementData advertisementData;
  advertisementData.setName(BLE_DEVICE_NAME);
  advertisementData.setCompleteServices(BLEUUID(SERVICE_UUID));
  pAdvertising->setAdvertisementData(advertisementData);

  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising started");
  Serial.print("[BLE] Device name: ");
  Serial.println(BLE_DEVICE_NAME);

  String address = BLEDevice::getAddress().toString().c_str();
  Serial.print("[BLE] Device address: ");
  Serial.println(address);
}

bool BLEManager::isConnected() const {
  return deviceConnected;
}

unsigned long BLEManager::getConnectionTime() const {
  return connectionTime;
}

unsigned long BLEManager::getSampleIntervalMs() const {
  return sampleIntervalMs;
}

void BLEManager::setSampleIntervalMs(unsigned long intervalMs) {
  if (intervalMs >= MIN_SAMPLE_INTERVAL_MS && intervalMs <= MAX_SAMPLE_INTERVAL_MS) {
    sampleIntervalMs = intervalMs;
  }
}

uint8_t BLEManager::getPowerMode() const {
  return deviceConfig.powerMode;
}

uint8_t BLEManager::getLedMode() const {
  return deviceConfig.ledMode;
}

unsigned long BLEManager::getLastNotifyTime() const {
  return lastNotifyTime;
}

void BLEManager::sendSensorData(const SensorData& data) {
  unsigned long start = micros();

  // Pack data into binary format (47 bytes total - magnetometer removed)
  // Old: 60 bytes (9DoF with mag), New: 47 bytes (6DoF, no mag)
  uint8_t buffer[SENSOR_DATA_PACKET_SIZE];
  int offset = 0;

  // Timestamp (4 bytes)
  memcpy(buffer + offset, &data.timestamp, 4);
  offset += 4;

  // Euler angles (12 bytes)
  memcpy(buffer + offset, &data.roll, 4);
  offset += 4;
  memcpy(buffer + offset, &data.pitch, 4);
  offset += 4;
  memcpy(buffer + offset, &data.yaw, 4);
  offset += 4;

  // Acceleration (12 bytes)
  memcpy(buffer + offset, &data.accel_x, 4);
  offset += 4;
  memcpy(buffer + offset, &data.accel_y, 4);
  offset += 4;
  memcpy(buffer + offset, &data.accel_z, 4);
  offset += 4;

  // Gyroscope (12 bytes)
  memcpy(buffer + offset, &data.gyro_x, 4);
  offset += 4;
  memcpy(buffer + offset, &data.gyro_y, 4);
  offset += 4;
  memcpy(buffer + offset, &data.gyro_z, 4);
  offset += 4;

  // Magnetometer removed - using 6DoF mode (saves 12 bytes)

  // Calibration (3 bytes - removed cal_mag)
  buffer[offset++] = data.cal_sys;
  buffer[offset++] = data.cal_gyro;
  buffer[offset++] = data.cal_accel;

  // Battery voltage (4 bytes)
  memcpy(buffer + offset, &data.battery_voltage, 4);
  offset += 4;

  // Total: 4 + 12 + 12 + 12 + 3 + 4 = 47 bytes

  // Send notification
  pCharacteristic->setValue(buffer, SENSOR_DATA_PACKET_SIZE);
  pCharacteristic->notify();

  lastNotifyTime = micros() - start;
}
