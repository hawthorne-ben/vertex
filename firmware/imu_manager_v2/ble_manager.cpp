/*
 * BLE Manager V2 Implementation
 * Command handling, status notifications, chunked file transfer
 */

#include "ble_manager.h"
#include "sensor_manager.h"
#include "storage_manager.h"

// Defined in main sketch
extern void startRecording();
extern void stopRecording();
extern void syncClock(int64_t unixMs);
extern bool isClockSynced();
extern int64_t wallClockMs();

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

    g_ble->_pendingCmd = (uint8_t)value[0];
    g_ble->_cmdPayloadLen = min((int)value.length() - 1, 63);
    if (g_ble->_cmdPayloadLen > 0) {
      memcpy(g_ble->_cmdPayload, value.c_str() + 1, g_ble->_cmdPayloadLen);
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
    _cmdPayloadLen(0),
    _transferActive(false),
    _transferOffset(0),
    _transferSize(0) {
  g_ble = this;
}

void BLEManager::init() {
  Serial.println("[BLE] Initializing...");

  BLEDevice::init(BLE_DEVICE_NAME);
  _server = BLEDevice::createServer();
  _server->setCallbacks(new ServerCallbacks());

  BLEService* service = _server->createService(BLEUUID(SERVICE_UUID), 20);

  // Status characteristic (notify)
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

  // File list characteristic (read/notify)
  _fileListChar = service->createCharacteristic(
    FILE_LIST_CHAR_UUID,
    BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY
  );
  _fileListChar->addDescriptor(new BLE2902());

  // File data characteristic (notify) — chunked file transfer
  _fileDataChar = service->createCharacteristic(
    FILE_DATA_CHAR_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  _fileDataChar->addDescriptor(new BLE2902());

  service->start();

  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.printf("[BLE] Advertising as '%s'\n", BLE_DEVICE_NAME);
}

bool BLEManager::isConnected() const {
  return _connected;
}

void BLEManager::processCommands(DeviceState& state, SensorManager& sensor, StorageManager& storage) {
  // Continue chunked file transfer if active
  if (_transferActive) {
    sendNextChunk(storage);
    if (!_transferActive) {
      // Transfer just finished
      state = STATE_IDLE;
      Serial.println("[BLE] Transfer complete");
    }
    return;
  }

  uint8_t cmd = _pendingCmd;
  if (cmd == 0) return;
  _pendingCmd = 0;

  Serial.printf("[BLE] Command: 0x%02X\n", cmd);

  switch (cmd) {
    case CMD_GET_STATUS:
      sendStatus(state, 0.0f, 0);
      break;

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
      int count = storage.listFiles(entries, 32);
      Serial.printf("[BLE] %d files on SD\n", count);

      // Pack: count(1) + [name_len(1) + name(N) + size(4)] per file
      uint8_t buf[512];
      int off = 0;
      buf[off++] = (uint8_t)count;
      for (int i = 0; i < count && off < 500; i++) {
        uint8_t nameLen = strlen(entries[i].name);
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

    case CMD_REQUEST_FILE: {
      if (_cmdPayloadLen > 0 && state == STATE_IDLE) {
        char filename[64];
        int len = min((int)_cmdPayloadLen, 63);
        memcpy(filename, _cmdPayload, len);
        filename[len] = '\0';
        Serial.printf("[BLE] File request: %s\n", filename);

        if (storage.openFileForRead(filename)) {
          _transferActive = true;
          _transferOffset = 0;
          _transferSize = 0;  // We'll send until EOF
          state = STATE_SYNCING;

          // Send header packet: total file size (4 bytes)
          // The app uses this to show transfer progress
          // We don't know size upfront easily, so send 0 = "stream until EOF"
          uint8_t hdr[5];
          hdr[0] = 0xFF;  // Header marker
          uint32_t sz = 0;
          memcpy(hdr + 1, &sz, 4);
          _fileDataChar->setValue(hdr, 5);
          _fileDataChar->notify();
        } else {
          Serial.printf("[BLE] File not found: %s\n", filename);
        }
      }
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

void BLEManager::sendStatus(DeviceState state, float batteryVoltage, uint32_t fileCount) {
  if (!_connected) return;

  // Pack: state(1) + battery_mv(2) + file_count(2) + free_mb(2) + clock_synced(1)
  uint8_t buf[8];
  buf[0] = (uint8_t)state;
  uint16_t battMv = (uint16_t)(batteryVoltage * 1000);
  memcpy(buf + 1, &battMv, 2);
  uint16_t fc = (uint16_t)fileCount;
  memcpy(buf + 3, &fc, 2);
  uint16_t freeMb = 0;  // TODO: pass from storage
  memcpy(buf + 5, &freeMb, 2);
  buf[7] = isClockSynced() ? 1 : 0;

  _statusChar->setValue(buf, 8);
  _statusChar->notify();
}

void BLEManager::sendNextChunk(StorageManager& storage) {
  // Read up to 512 bytes and notify
  // BLE 5 DLE supports up to 512-byte payloads
  uint8_t buf[516];
  buf[0] = 0x00;  // Data chunk marker (vs 0xFF header, 0x01 EOF)

  // Sequence number (helps receiver detect drops)
  uint16_t seq = (uint16_t)(_transferOffset / 512);
  memcpy(buf + 1, &seq, 2);

  int bytesRead = storage.readFileChunk(buf + 3, 509);
  if (bytesRead <= 0) {
    // EOF — send end marker
    uint8_t eof[3];
    eof[0] = 0x01;  // EOF marker
    uint16_t totalChunks = seq;
    memcpy(eof + 1, &totalChunks, 2);
    _fileDataChar->setValue(eof, 3);
    _fileDataChar->notify();

    storage.closeReadFile();
    _transferActive = false;
    Serial.printf("[BLE] Transfer done: %lu bytes\n", (unsigned long)_transferOffset);
    return;
  }

  _fileDataChar->setValue(buf, 3 + bytesRead);
  _fileDataChar->notify();
  _transferOffset += bytesRead;

  // Small delay to let BLE stack breathe
  delay(5);
}
