/*
 * BLE Manager V2 Implementation
 * Command handling, status notifications, chunked file transfer
 * Uses Bluedroid (ESP32 built-in BLE stack).
 */

#include "ble_manager.h"
#include "sensor_manager.h"
#include "storage_manager.h"
#include "wifi_manager.h"
#include "power_manager.h"

// Defined in main sketch
extern void startRecording();
extern void stopRecording();
extern void syncClock(int64_t unixMs);
extern bool isClockSynced();
extern int64_t wallClockMs();
extern uint32_t getRecordingElapsedSecs();

// Global instance for callbacks
BLEManager* g_ble = nullptr;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* server) {
    if (g_ble) {
      g_ble->_connected = true;
      g_ble->_connectionTime = millis();
      Serial.println("[BLE] Client connected");
    }
  }
  void onDisconnect(BLEServer* server) {
    if (g_ble) {
      g_ble->_connected = false;
      Serial.println("[BLE] Client disconnected");
    }
    BLEDevice::startAdvertising();
  }
};

class ConfigCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    if (!g_ble) return;
    String value = pChar->getValue();
    if (value.length() < 1) return;

    const uint8_t* data = (const uint8_t*)value.c_str();
    g_ble->_pendingCmd = data[0];
    g_ble->_cmdPayloadLen = min((int)value.length() - 1, 255);
    if (g_ble->_cmdPayloadLen > 0) {
      memcpy(g_ble->_cmdPayload, data + 1, g_ble->_cmdPayloadLen);
    }
  }
};

BLEManager::BLEManager()
  : _server(nullptr),
    _statusChar(nullptr),
    _configChar(nullptr),
    _fileListChar(nullptr),
    _fileDataChar(nullptr),
    _connected(false),
    _connectionTime(0),
    _pendingCmd(0),
    _cmdPayloadLen(0) {
  g_ble = this;
}

void BLEManager::init() {
  Serial.println("[BLE] Initializing (Bluedroid)...");

  BLEDevice::init(BLE_DEVICE_NAME);
  _server = BLEDevice::createServer();
  _server->setCallbacks(new ServerCallbacks());

  BLEService* service = _server->createService(BLEUUID(SERVICE_UUID), 20);

  // Status characteristic (read + notify)
  _statusChar = service->createCharacteristic(
    SENSOR_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  _statusChar->addDescriptor(new BLE2902());

  // Config/command characteristic (write)
  _configChar = service->createCharacteristic(
    CONFIG_CHAR_UUID,
    BLECharacteristic::PROPERTY_WRITE
  );
  _configChar->setCallbacks(new ConfigCallbacks());

  // File list characteristic (read + notify)
  _fileListChar = service->createCharacteristic(
    FILE_LIST_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  _fileListChar->addDescriptor(new BLE2902());

  // File data characteristic (notify)
  _fileDataChar = service->createCharacteristic(
    FILE_DATA_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  _fileDataChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  adv->setMinPreferred(0x06);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", BLE_DEVICE_NAME);
}

bool BLEManager::isConnected() const {
  return _connected;
}

void BLEManager::processCommands(DeviceState& state, SensorManager& sensor, StorageManager& storage, WiFiUploadManager& wifi, PowerManager& power) {
  uint8_t cmd = _pendingCmd;
  if (cmd == 0) return;
  _pendingCmd = 0;

  Serial.printf("[BLE] Command: 0x%02X\n", cmd);

  switch (cmd) {
    case CMD_GET_STATUS: {
      int fileCount = storage.listFiles(nullptr, 0);
      uint16_t freeMb = (uint16_t)storage.getFreeSpaceMB();
      float battV = power.getBatteryVoltage();
      bool sdOk = storage.isReady();
      bool imuOk = sensor.isHealthy();
      float ax, ay, az;
      sensor.getLatestAccel(ax, ay, az);
      if (state == STATE_UPLOADING) {
        SyncProgress sp = wifi.getProgress();
        sendStatus(state, battV, fileCount, freeMb, sdOk, imuOk, ax, ay, az, &sp);
      } else if (state == STATE_RECORDING) {
        uint32_t recSecs = getRecordingElapsedSecs();
        uint32_t recBytes = storage.getCurrentFileSize();
        sendStatus(state, battV, fileCount, freeMb, sdOk, imuOk, ax, ay, az, nullptr, recSecs, recBytes);
      } else {
        sendStatus(state, battV, fileCount, freeMb, sdOk, imuOk, ax, ay, az);
      }
      break;
    }

    case CMD_START_RECORDING:
      startRecording();
      break;

    case CMD_STOP_RECORDING:
      stopRecording();
      break;

    case CMD_SYNC_CLOCK: {
      if (_cmdPayloadLen >= 8) {
        int64_t phoneTimeMs;
        memcpy(&phoneTimeMs, _cmdPayload, 8);
        syncClock(phoneTimeMs);
      } else {
        Serial.println("[BLE] SYNC_CLOCK: need 8-byte payload");
      }
      break;
    }

    case CMD_LIST_FILES: {
      FileEntry entries[32];
      int totalCount = storage.listFiles(entries, 32);
      Serial.printf("[BLE] %d files on SD\n", totalCount);

      // Send the 10 most recent files (last 10 from listing)
      int startIdx = (totalCount > 10) ? totalCount - 10 : 0;
      int sendCount = totalCount - startIdx;

      // Pack: totalCount(1) + packedCount(1) + [name_len(1) + name(N) + size(4) + synced(1)] per file
      uint8_t buf[512];
      int off = 0;
      buf[off++] = (uint8_t)totalCount;   // Total files on SD
      buf[off++] = (uint8_t)sendCount;    // Files in this response
      for (int i = startIdx; i < totalCount; i++) {
        uint8_t nameLen = strlen(entries[i].name);
        int entrySize = 1 + nameLen + 4 + 1;
        if (off + entrySize > 500) break;
        buf[off++] = nameLen;
        memcpy(buf + off, entries[i].name, nameLen);
        off += nameLen;
        uint32_t sz = entries[i].size;
        memcpy(buf + off, &sz, 4);
        off += 4;
        buf[off++] = wifi.isFileSynced(entries[i].name) ? 1 : 0;
      }
      _fileListChar->setValue(buf, off);
      _fileListChar->notify();
      break;
    }

    case CMD_DELETE_FILE: {
      if (_cmdPayloadLen > 0) {
        char filename[64];
        int len = min((int)_cmdPayloadLen, 63);
        memcpy(filename, _cmdPayload, len);
        filename[len] = '\0';
        bool ok = storage.deleteFile(filename);
        Serial.printf("[BLE] Delete %s: %s\n", filename, ok ? "OK" : "FAIL");
      }
      break;
    }

    case CMD_SET_WIFI: {
      // Payload: SSID\0PASSWORD
      if (_cmdPayloadLen > 1) {
        char ssid[33] = {0};
        char password[65] = {0};
        // Find null separator
        int sepIdx = -1;
        for (int i = 0; i < _cmdPayloadLen; i++) {
          if (_cmdPayload[i] == '\0') { sepIdx = i; break; }
        }
        if (sepIdx > 0 && sepIdx < 32) {
          memcpy(ssid, _cmdPayload, sepIdx);
          int passLen = _cmdPayloadLen - sepIdx - 1;
          if (passLen > 0 && passLen < 64) {
            memcpy(password, _cmdPayload + sepIdx + 1, passLen);
          }
          wifi.saveWiFiCredentials(ssid, password);
        } else {
          Serial.println("[BLE] SET_WIFI: invalid payload format");
        }
      }
      break;
    }

    case CMD_SET_USER: {
      // Payload: userId\0apiKey\0serverUrl
      if (_cmdPayloadLen > 2) {
        char userId[64] = {0};
        char apiKey[65] = {0};
        char serverUrl[128] = {0};
        // Find two null separators
        int sep1 = -1, sep2 = -1;
        for (int i = 0; i < _cmdPayloadLen; i++) {
          if (_cmdPayload[i] == '\0') {
            if (sep1 < 0) sep1 = i;
            else { sep2 = i; break; }
          }
        }
        if (sep1 > 0 && sep2 > sep1) {
          int userLen = sep1;
          int keyLen = sep2 - sep1 - 1;
          int urlLen = _cmdPayloadLen - sep2 - 1;
          if (userLen < 64 && keyLen < 65 && urlLen < 128 && urlLen > 0) {
            memcpy(userId, _cmdPayload, userLen);
            memcpy(apiKey, _cmdPayload + sep1 + 1, keyLen);
            memcpy(serverUrl, _cmdPayload + sep2 + 1, urlLen);
            wifi.saveUserCredentials(userId, apiKey, serverUrl);
          } else {
            Serial.println("[BLE] SET_USER: field too long");
          }
        } else {
          Serial.println("[BLE] SET_USER: invalid payload format");
        }
      }
      break;
    }

    case CMD_START_SYNC: {
      if (state == STATE_IDLE) {
        setCpuFrequencyMhz(CPU_MHZ_WIFI);
        state = STATE_UPLOADING;
        wifi.startSync(storage);
      } else {
        Serial.printf("[BLE] Cannot sync — state=%d\n", state);
      }
      break;
    }

    case CMD_CANCEL_SYNC: {
      if (state == STATE_UPLOADING) {
        wifi.cancelSync();
        setCpuFrequencyMhz(CPU_MHZ_NORMAL);
        state = STATE_IDLE;
      }
      break;
    }

    case CMD_RESET:
      Serial.println("[BLE] Reset requested");
      delay(100);
      ESP.restart();
      break;

    default:
      Serial.printf("[BLE] Unknown command: 0x%02X\n", cmd);
      break;
  }
}

void BLEManager::sendStatus(DeviceState state, float batteryVoltage, uint32_t fileCount, uint16_t freeMb,
                            bool sdOk, bool imuOk, float accelX, float accelY, float accelZ,
                            const SyncProgress* syncProgress,
                            uint32_t recordingSecs, uint32_t recordingBytes) {
  if (!_connected) return;

  // Base: state(1) + battery_mv(2) + file_count(2) + free_mb(2) + clock_synced(1)
  //       + flags(1) + accel_x(2) + accel_y(2) + accel_z(2) = 15 bytes
  // Recording: + rec_secs(4) + rec_bytes(4) = +8 bytes (total 23)
  // Uploading:  + current_file(1) + total_files(1) + bytes_sent(4) + bytes_total(4) + result(1) = +11 bytes (total 26)
  uint8_t buf[26];
  buf[0] = (uint8_t)state;
  uint16_t battMv = (uint16_t)(batteryVoltage * 1000);
  memcpy(buf + 1, &battMv, 2);
  uint16_t fc = (uint16_t)fileCount;
  memcpy(buf + 3, &fc, 2);
  memcpy(buf + 5, &freeMb, 2);
  buf[7] = isClockSynced() ? 1 : 0;

  // Flags: bit0 = SD OK, bit1 = IMU OK
  buf[8] = (sdOk ? 0x01 : 0x00) | (imuOk ? 0x02 : 0x00);

  // Accel as int16 in milli-g (1g ≈ 9.81 m/s², so mg = m/s² * 1000 / 9.80665)
  int16_t axMg = (int16_t)(accelX * (1000.0f / 9.80665f));
  int16_t ayMg = (int16_t)(accelY * (1000.0f / 9.80665f));
  int16_t azMg = (int16_t)(accelZ * (1000.0f / 9.80665f));
  memcpy(buf + 9, &axMg, 2);
  memcpy(buf + 11, &ayMg, 2);
  memcpy(buf + 13, &azMg, 2);

  int len = 15;
  if (syncProgress) {
    buf[15] = syncProgress->currentFile;
    buf[16] = syncProgress->totalFiles;
    memcpy(buf + 17, &syncProgress->bytesSent, 4);
    memcpy(buf + 21, &syncProgress->bytesTotal, 4);
    buf[25] = syncProgress->result;
    len = 26;
  } else if (state == STATE_RECORDING && (recordingSecs > 0 || recordingBytes > 0)) {
    memcpy(buf + 15, &recordingSecs, 4);
    memcpy(buf + 19, &recordingBytes, 4);
    len = 23;
  }

  _statusChar->setValue(buf, len);
  _statusChar->notify();
}
