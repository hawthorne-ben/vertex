/*
 * BLE Manager V2 - Command processing, status notifications, file transfer
 *
 * Reuses V1 service UUID for app compatibility.
 * Adds file listing + chunked file transfer characteristics.
 */

#ifndef BLE_MANAGER_H
#define BLE_MANAGER_H

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include "config.h"

// Forward declarations
class SensorManager;
class StorageManager;

class BLEManager {
public:
  BLEManager();

  void init();
  bool isConnected() const;

  // Process incoming commands, dispatch to sensor/storage as needed.
  void processCommands(DeviceState& state, SensorManager& sensor, StorageManager& storage);

  // Send status notification (battery, recording state, file count)
  void sendStatus(DeviceState state, float batteryVoltage, uint32_t fileCount);

  // True while chunked file transfer is in progress
  bool isTransferring() const { return _transferActive; }

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
  uint8_t _cmdPayload[64];
  volatile uint8_t _cmdPayloadLen;

  // File transfer state
  bool _transferActive;
  uint32_t _transferOffset;
  uint32_t _transferSize;

  void sendNextChunk(StorageManager& storage);

  friend class ServerCallbacks;
  friend class ConfigCallbacks;
};

#endif // BLE_MANAGER_H
