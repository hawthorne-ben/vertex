/*
 * BLE Manager - Handles all Bluetooth Low Energy communication
 * Manages BLE server, services, characteristics, and data transmission
 */

#ifndef BLE_MANAGER_H
#define BLE_MANAGER_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "config.h"

// Forward declaration
struct SensorData;

class BLEManager {
public:
  BLEManager();

  // Initialize BLE device, server, and services
  void init();

  // Check if a client is connected
  bool isConnected() const;

  // Get time since connection established
  unsigned long getConnectionTime() const;

  // Send sensor data via BLE notification
  void sendSensorData(const SensorData& data);

  // Get current sample interval (modified by config commands)
  unsigned long getSampleIntervalMs() const;

  // Set sample interval
  void setSampleIntervalMs(unsigned long intervalMs);

  // Get device configuration
  uint8_t getPowerMode() const;
  uint8_t getLedMode() const;

  // Performance metrics
  unsigned long getLastNotifyTime() const;

private:
  BLEServer* pServer;
  BLEService* pService;
  BLECharacteristic* pCharacteristic;
  BLECharacteristic* pConfigCharacteristic;

  bool deviceConnected;
  unsigned long connectionTime;
  unsigned long sampleIntervalMs;
  unsigned long lastNotifyTime;

  struct DeviceConfig {
    uint8_t powerMode;     // 0=low, 1=normal, 2=high performance
    uint8_t ledMode;       // 0=off, 1=status, 2=always-on
    bool autoCalibrate;    // Auto-calibration enabled
  } deviceConfig;

  // Friend classes for callbacks
  friend class MyServerCallbacks;
  friend class MyCharacteristicCallbacks;
  friend class MyConfigCallbacks;
};

#endif // BLE_MANAGER_H
