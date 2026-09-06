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

  // ===== Periodic clock sync (VTX v1.2) =====
  // Non-blocking request/response. requestPhoneTime() sends a notification and
  // returns immediately; the reply arrives on the BLE write callback and is
  // collected by pollTimeResponse() on a later loop() iteration. Nothing here
  // ever blocks the FIFO service path.

  // Send a time request to the phone. Returns false if not connected or a
  // request is already in flight.
  bool requestPhoneTime();

  // True while a request is outstanding and not yet timed out.
  bool isTimeRequestPending() const;

  // Collect a completed exchange. Returns true and fills the four timestamps
  // exactly once per successful request. Returns false when nothing is ready.
  bool pollTimeResponse(uint32_t& t1, uint32_t& t4, int64_t& t2, int64_t& t3);

  // Abandon an in-flight request that has exceeded CLOCK_SYNC_TIMEOUT_MS.
  // Returns true if a request was actually timed out (for logging).
  bool expireStaleTimeRequest();

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

  // Periodic time-sync exchange state
  volatile bool _timeReqPending;    // request sent, awaiting reply
  volatile bool _timeRespReady;     // reply captured, awaiting collection
  uint32_t _timeReqT1;              // millis() at request send
  volatile uint32_t _timeRespT4;    // millis() at reply receipt (set in callback)
  volatile int64_t _timeRespT2;     // phone time at request receipt
  volatile int64_t _timeRespT3;     // phone time at reply send

  // Pending command from BLE write callback
  volatile uint8_t _pendingCmd;
  uint8_t _cmdPayload[256];
  volatile uint8_t _cmdPayloadLen;

  friend class ServerCallbacks;
  friend class ConfigCallbacks;
};

#endif // BLE_MANAGER_H
