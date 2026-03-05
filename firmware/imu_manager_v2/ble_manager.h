/*
 * BLE Manager V2 - Command processing, status notifications, file transfer
 *
 * Reuses V1 service UUID for app compatibility.
 * Uses NimBLE for ~50% less flash than Bluedroid.
 */

#ifndef BLE_MANAGER_H
#define BLE_MANAGER_H

#include <Arduino.h>
#include <NimBLEDevice.h>
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

  // Send status notification (battery, recording state, file count, free space)
  // When state == STATE_UPLOADING, syncProgress is included in the notification
  void sendStatus(DeviceState state, float batteryVoltage, uint32_t fileCount, uint16_t freeMb,
                  const struct SyncProgress* syncProgress = nullptr);

private:
  NimBLEServer* _server;
  NimBLECharacteristic* _statusChar;
  NimBLECharacteristic* _configChar;
  NimBLECharacteristic* _fileListChar;
  NimBLECharacteristic* _fileDataChar;

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
