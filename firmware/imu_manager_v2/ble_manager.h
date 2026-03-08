/*
 * BLE Manager V2 - Command processing, status notifications, file transfer
 *
 * Reuses V1 service UUID for app compatibility.
 * Uses Bluedroid (ESP32 built-in BLE stack).
 */

#ifndef BLE_MANAGER_H
#define BLE_MANAGER_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include "config.h"

// Forward declarations
class SensorManager;
class StorageManager;
class WiFiUploadManager;
class PowerManager;

class BLEManager {
public:
  BLEManager();

  void init();
  bool isConnected() const;

  // Process incoming commands, dispatch to sensor/storage/wifi as needed.
  void processCommands(DeviceState& state, SensorManager& sensor, StorageManager& storage, WiFiUploadManager& wifi, PowerManager& power);

  // Send status notification (battery, recording state, file count, free space, health, accel)
  // When state == STATE_UPLOADING, syncProgress is included in the notification
  // When state == STATE_RECORDING, recordingSecs and recordingBytes are included
  void sendStatus(DeviceState state, float batteryVoltage, uint32_t fileCount, uint16_t freeMb,
                  bool sdOk, bool imuOk, float accelX, float accelY, float accelZ,
                  const struct SyncProgress* syncProgress = nullptr,
                  uint32_t recordingSecs = 0, uint32_t recordingBytes = 0);

private:
  BLEServer* _server;
  BLECharacteristic* _statusChar;
  BLECharacteristic* _configChar;
  BLECharacteristic* _fileListChar;
  BLECharacteristic* _fileDataChar;

  bool _connected;
  unsigned long _connectionTime;

  // Pending command from BLE write callback
  volatile uint8_t _pendingCmd;
  uint8_t _cmdPayload[256];
  volatile uint8_t _cmdPayloadLen;

  friend class ServerCallbacks;
  friend class ConfigCallbacks;
};

#endif // BLE_MANAGER_H
