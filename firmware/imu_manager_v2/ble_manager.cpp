/*
 * BLE Manager V2 Implementation
 * Command handling, status notifications, chunked file transfer
 * Uses NimBLE for reduced flash footprint.
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

// Global instance for callbacks
BLEManager* g_ble = nullptr;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& connInfo) {
    if (g_ble) {
      g_ble->_connected = true;
      g_ble->_connectionTime = millis();
      Serial.println("[BLE] Client connected");
    }
  }
  void onDisconnect(NimBLEServer* server, NimBLEConnInfo& connInfo, int reason) {
    if (g_ble) {
      g_ble->_connected = false;
      Serial.println("[BLE] Client disconnected");
    }
    NimBLEDevice::startAdvertising();
  }
};

class ConfigCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* pChar, NimBLEConnInfo& connInfo) {
    if (!g_ble) return;
    NimBLEAttValue value = pChar->getValue();
    if (value.length() < 1) return;

    const uint8_t* data = value.data();
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
  Serial.println("[BLE] Initializing (NimBLE)...");

  NimBLEDevice::init(BLE_DEVICE_NAME);
  _server = NimBLEDevice::createServer();
  _server->setCallbacks(new ServerCallbacks());

  NimBLEService* service = _server->createService(SERVICE_UUID);

  // Status characteristic (read + notify)
  // NimBLE auto-creates 2902 descriptor for notify/indicate
  _statusChar = service->createCharacteristic(
    SENSOR_CHAR_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );

  // Config/command characteristic (write)
  _configChar = service->createCharacteristic(
    CONFIG_CHAR_UUID,
    NIMBLE_PROPERTY::WRITE
  );
  _configChar->setCallbacks(new ConfigCallbacks());

  // File list characteristic (read + notify)
  _fileListChar = service->createCharacteristic(
    FILE_LIST_CHAR_UUID,
    NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY
  );

  // File data characteristic (notify)
  _fileDataChar = service->createCharacteristic(
    FILE_DATA_CHAR_UUID,
    NIMBLE_PROPERTY::NOTIFY
  );

  service->start();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->enableScanResponse(true);
  NimBLEDevice::startAdvertising();

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
      if (state == STATE_UPLOADING) {
        SyncProgress sp = wifi.getProgress();
        sendStatus(state, battV, fileCount, freeMb, &sp);
      } else {
        sendStatus(state, battV, fileCount, freeMb);
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

      // Pack: totalCount(1) + packedCount(1) + [name_len(1) + name(N) + size(4)] per file
      uint8_t buf[512];
      int off = 0;
      buf[off++] = (uint8_t)totalCount;   // Total files on SD
      buf[off++] = (uint8_t)sendCount;    // Files in this response
      for (int i = startIdx; i < totalCount; i++) {
        uint8_t nameLen = strlen(entries[i].name);
        int entrySize = 1 + nameLen + 4;
        if (off + entrySize > 500) break;
        buf[off++] = nameLen;
        memcpy(buf + off, entries[i].name, nameLen);
        off += nameLen;
        uint32_t sz = entries[i].size;
        memcpy(buf + off, &sz, 4);
        off += 4;
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
                            const SyncProgress* syncProgress) {
  if (!_connected) return;

  // Base: state(1) + battery_mv(2) + file_count(2) + free_mb(2) + clock_synced(1) = 8 bytes
  // Extended (uploading/result): + current_file(1) + total_files(1) + bytes_sent(4) + bytes_total(4) + result(1) = +11 bytes
  uint8_t buf[19];
  buf[0] = (uint8_t)state;
  uint16_t battMv = (uint16_t)(batteryVoltage * 1000);
  memcpy(buf + 1, &battMv, 2);
  uint16_t fc = (uint16_t)fileCount;
  memcpy(buf + 3, &fc, 2);
  memcpy(buf + 5, &freeMb, 2);
  buf[7] = isClockSynced() ? 1 : 0;

  int len = 8;
  if (syncProgress) {
    buf[8] = syncProgress->currentFile;
    buf[9] = syncProgress->totalFiles;
    memcpy(buf + 10, &syncProgress->bytesSent, 4);
    memcpy(buf + 14, &syncProgress->bytesTotal, 4);
    buf[18] = syncProgress->result;
    len = 19;
  }

  _statusChar->setValue(buf, len);
  _statusChar->notify();
}
