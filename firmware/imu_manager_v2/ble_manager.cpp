/*
 * BLE Manager V2 Implementation
 * Command handling, status notifications, chunked file transfer
 * Uses Bluedroid (ESP32 built-in BLE stack).
 */

#include "ble_manager.h"
// The peer-identifying connect/disconnect overloads are stack-specific: this
// core builds NimBLE (CONFIG_NIMBLE_ENABLED), which passes ble_gap_conn_desc,
// while Bluedroid passes esp_ble_gatts_cb_param_t. Both are guarded below so
// the file compiles either way.
#include "sensor_manager.h"
#include "storage_manager.h"
#include "wifi_manager.h"
#include "power_manager.h"
#include "log_manager.h"

// Defined in main sketch
extern void startRecording();
extern void stopRecording();
extern void syncClock(int64_t unixMs);
extern bool isClockSynced();
extern int64_t wallClockMs();
extern uint32_t getRecordingElapsedSecs();

// Global instance for callbacks
BLEManager* g_ble = nullptr;

// Last 3 bytes of a peer address, as "aa:bb:cc".
//
// Identifies WHICH central connected. Without it every connect line is
// identical, so a phone dropping mid-ride is indistinguishable from a laptop
// tool session — exactly the ambiguity that makes a log hard to read after the
// fact. Three bytes tell two devices apart without writing a full MAC to the
// card.
static void formatPeer(char* out, size_t n, const uint8_t* bda) {
  if (!bda) {
    snprintf(out, n, "unknown");
    return;
  }
  snprintf(out, n, "%02x:%02x:%02x", bda[3], bda[4], bda[5]);
}

class ServerCallbacks : public BLEServerCallbacks {
  // Shared state updates + logging, called from whichever stack-specific
  // overload the core dispatches. `peer` identifies WHICH central connected:
  // without it every connect line is identical, so a phone dropping mid-ride
  // reads the same as a laptop tool session — exactly the ambiguity that makes
  // a log hard to interpret after the fact.
  void handleConnect(const char* peer) {
    if (g_ble) {
      g_ble->_connected = true;
      g_ble->_connectionTime = millis();
    }
    // INFO, not DEBUG: connect/disconnect pairs are the primary evidence for
    // the app's disconnect/re-register defect (VALIDATION_PLAN.md §C3). A drop
    // mid-ride permanently disables clock sync, and this is where that becomes
    // visible.
    LOG_I("BLE", "client connected peer=%s", peer);
  }

  // `reason` is the stack's disconnect reason, or 0 when unavailable. It
  // separates a link that dropped (supervision timeout — range, body blocking,
  // interference) from one the peer closed deliberately. On a ride those mean
  // completely different things. The raw code is kept rather than interpreted,
  // so an unfamiliar value is still recoverable from the log.
  void handleDisconnect(const char* peer, unsigned reason) {
    bool droppedInFlight = false;
    if (g_ble) {
      g_ble->_connected = false;
      // Drop any in-flight time request: its reply can never arrive, and a
      // stale t1 would produce a bogus RTT if the phone reconnects.
      droppedInFlight = g_ble->_timeReqPending;
      g_ble->_timeReqPending = false;
      g_ble->_timeRespReady = false;
    }

    // WARN when a time request was in flight: that exchange is lost, and the
    // pairing of this line with the next sync attempt is what separates "app
    // stopped answering" from "device stopped asking".
    if (droppedInFlight) {
      LOG_W("BLE", "client disconnected peer=%s reason=0x%02X (time request in flight)",
            peer, reason);
    } else {
      LOG_I("BLE", "client disconnected peer=%s reason=0x%02X", peer, reason);
    }
    BLEDevice::startAdvertising();
  }

#if defined(CONFIG_NIMBLE_ENABLED)
  // Last 3 bytes of the peer address — enough to tell two centrals apart in a
  // log without writing a full MAC to the card.
  static void formatPeer(char* out, size_t n, const uint8_t* v) {
    snprintf(out, n, "%02x:%02x:%02x", v[3], v[4], v[5]);
  }

  void onConnect(BLEServer* server, ble_gap_conn_desc* desc) {
    char peer[16] = "unknown";
    if (desc) formatPeer(peer, sizeof(peer), desc->peer_id_addr.val);
    handleConnect(peer);
  }

  void onDisconnect(BLEServer* server, ble_gap_conn_desc* desc) {
    char peer[16] = "unknown";
    if (desc) formatPeer(peer, sizeof(peer), desc->peer_id_addr.val);
    handleDisconnect(peer, 0);
  }
#endif

#if defined(CONFIG_BLUEDROID_ENABLED)
  static void formatPeerBd(char* out, size_t n, const uint8_t* v) {
    snprintf(out, n, "%02x:%02x:%02x", v[3], v[4], v[5]);
  }

  void onConnect(BLEServer* server, esp_ble_gatts_cb_param_t* param) {
    char peer[16] = "unknown";
    if (param) formatPeerBd(peer, sizeof(peer), param->connect.remote_bda);
    handleConnect(peer);
  }

  void onDisconnect(BLEServer* server, esp_ble_gatts_cb_param_t* param) {
    char peer[16] = "unknown";
    unsigned reason = 0;
    if (param) {
      formatPeerBd(peer, sizeof(peer), param->disconnect.remote_bda);
      reason = (unsigned)param->disconnect.reason;
    }
    handleDisconnect(peer, reason);
  }
#endif

  // The core dispatches BOTH the no-param and the stack-specific overload for
  // every event, so these must stay silent or each connect/disconnect is
  // logged twice — once as peer=unknown and once with the real address.
  // Observed on hardware 2026-09-12. The state updates are idempotent and
  // already done by the overload above; these exist only to satisfy the
  // virtual interface when no stack-specific overload is compiled in.
#if !defined(CONFIG_NIMBLE_ENABLED) && !defined(CONFIG_BLUEDROID_ENABLED)
  void onConnect(BLEServer* server) {
    handleConnect("unknown");
  }

  void onDisconnect(BLEServer* server) {
    handleDisconnect("unknown", 0);
  }
#endif
};

class ConfigCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) {
    if (!g_ble) return;
    // Stamp t4 first: anything done before this read — including dispatching
    // through processCommands() on a later loop() — would be charged to the
    // BLE round trip and inflate the measured RTT.
    uint32_t rxMs = millis();
    String value = pChar->getValue();
    if (value.length() < 1) return;

    const uint8_t* data = (const uint8_t*)value.c_str();

    // CMD_TIME_RESPONSE is handled inline rather than queued: it carries a
    // timestamp whose value depends on when it was received, and the single
    // _pendingCmd slot can be overwritten before processCommands() runs.
    if (data[0] == CMD_TIME_RESPONSE) {
      if (value.length() >= 17 && g_ble->_timeReqPending) {
        int64_t t2, t3;
        memcpy(&t2, data + 1, 8);
        memcpy(&t3, data + 9, 8);
        g_ble->_timeRespT2 = t2;
        g_ble->_timeRespT3 = t3;
        g_ble->_timeRespT4 = rxMs;
        g_ble->_timeReqPending = false;
        g_ble->_timeRespReady = true;
      }
      return;
    }

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
    _timeReqPending(false),
    _timeRespReady(false),
    _timeReqT1(0),
    _timeRespT4(0),
    _timeRespT2(0),
    _timeRespT3(0),
    _logReaderPos(0),
    _logReaderPosValid(false),
    _pendingCmd(0),
    _cmdPayloadLen(0) {
  g_ble = this;
}

void BLEManager::init() {
  Serial.println("[BLE] Initializing (Bluedroid)...");  // pre-logger: SD may not be up

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

  LOG_I("BLE", "advertising as '%s'", BLE_DEVICE_NAME);
}

bool BLEManager::isConnected() const {
  return _connected;
}

void BLEManager::processCommands(DeviceState& state, SensorManager& sensor, StorageManager& storage, WiFiUploadManager& wifi, PowerManager& power) {
  uint8_t cmd = _pendingCmd;
  if (cmd == 0) return;
  _pendingCmd = 0;

  // Level by cadence, not by category: a command the user triggered is a major
  // event and belongs at INFO, while anything the app emits on a timer is loop
  // traffic and belongs at DEBUG.
  //
  // CMD_GET_STATUS is the app's ~2 Hz poll — 7,200 lines/hour, enough to
  // overrun a 10 MB ring on chatter alone during a long ride. It stays DEBUG.
  // Every other command happens because somebody did something, so it is
  // visible at the default level.
  //
  // The log commands are exempt entirely. Reading the ring used to write to the
  // ring: every CMD_LOG_READ emitted a line that the next read then fetched, so
  // a single drain filled the buffer with its own traffic — self-referential
  // noise injected exactly when the level was lowered to investigate something
  // else. Observing a system must not perturb it.
  if (cmd == CMD_LOG_READ || cmd == CMD_LOG_STATUS) {
    // no trace
  } else if (cmd == CMD_GET_STATUS) {
    LOG_D("BLE", "command 0x%02X (status poll)", cmd);
  } else {
    LOG_I("BLE", "command 0x%02X", cmd);
  }

  switch (cmd) {
    case CMD_GET_STATUS: {
      int fileCount = storage.listFiles(nullptr, 0);
      uint16_t freeMb = (uint16_t)storage.getFreeSpaceMBCached();
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
        LOG_W("BLE", "SYNC_CLOCK: need 8-byte payload, got %u",
              (unsigned)_cmdPayloadLen);
      }
      break;
    }

    case CMD_LIST_FILES: {
      FileEntry entries[32];
      const int onDisk = storage.listFiles(nullptr, 0);       // true total
      const int fetched = storage.listFiles(entries, 32);     // what we hold
      // One per CMD_LIST_FILES, which is a user action, not a poll.
      LOG_I("BLE", "%d files on SD (%d fetched)", onDisk, fetched);

      // Directory order is filesystem order, not chronological — FAT reuses
      // freed entries, so a deletion makes the next file land wherever the
      // hole was. Sort by the timestamp encoded in the name before taking the
      // most recent, or "recent" means "wherever FAT put it".
      // Insertion sort: n <= 32 and the array is nearly ordered in practice.
      for (int i = 1; i < fetched; i++) {
        FileEntry key = entries[i];
        int64_t keyT = vtxFilenameSortKey(key.name);
        int j = i - 1;
        while (j >= 0 && vtxFilenameSortKey(entries[j].name) > keyT) {
          entries[j + 1] = entries[j];
          j--;
        }
        entries[j + 1] = key;
      }

      // Send the 10 most recent of what we fetched.
      int startIdx = (fetched > 10) ? fetched - 10 : 0;
      int sendCount = fetched - startIdx;

      // Pack: totalOnDisk(1) + packedCount(1) + [name_len(1) + name(N) + size(4) + synced(1)] per file
      uint8_t buf[512];
      int off = 0;
      // Distinct quantities: the card may hold more than we can enumerate.
      buf[off++] = (uint8_t)(onDisk > 255 ? 255 : onDisk);
      buf[off++] = (uint8_t)sendCount;
      for (int i = startIdx; i < fetched; i++) {
        uint8_t nameLen = strlen(entries[i].name);
        int entrySize = 1 + nameLen + 4 + 1;
        if (off + entrySize > (int)sizeof(buf)) break;
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
        // Deletion is destructive and irreversible — WARN on failure, INFO on
        // success, never DEBUG. "Where did that recording go" is a question
        // this line answers months later.
        if (ok) LOG_I("BLE", "deleted %s", filename);
        else    LOG_W("BLE", "delete failed: %s", filename);
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
          LOG_W("BLE", "SET_WIFI: invalid payload format");
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
            LOG_W("BLE", "SET_USER: field too long");
          }
        } else {
          LOG_W("BLE", "SET_USER: invalid payload format");
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
        LOG_W("BLE", "cannot sync — state=%d", state);
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

    case CMD_LOG_READ: {
      // [0x0F][position uint64]. An absent or short payload means "from the
      // oldest surviving byte" — position 0, which logPlanRead() clamps up to
      // the oldest survivor and reports the gap for.
      if (_cmdPayloadLen >= 8) {
        memcpy(&_logReaderPos, _cmdPayload, 8);
      } else if (!_logReaderPosValid) {
        _logReaderPos = 0;
      }
      _logReaderPosValid = true;
      sendLogChunk(logger);
      break;
    }

    case CMD_LOG_SET_LEVEL: {
      if (_cmdPayloadLen >= 1 && _cmdPayload[0] <= LOG_ERROR) {
        logger.setMinLevel(_cmdPayload[0]);
      } else {
        LOG_W("BLE", "LOG_SET_LEVEL: bad level");
      }
      sendLogStatus(logger);
      break;
    }

    case CMD_LOG_STATUS:
      sendLogStatus(logger);
      break;

    case CMD_LOG_CLEAR: {
      logger.clear();
      // Rewind this reader too. Its stored position refers to a ring that no
      // longer exists; leaving it would put the reader far "ahead" of a writer
      // that restarted at 0, and it would see nothing until the ring caught
      // back up to where it used to be.
      _logReaderPos = 0;
      _logReaderPosValid = true;
      sendLogStatus(logger);
      break;
    }

    case CMD_RESET:
      // INFO: a commanded reset is deliberate, not a failure. The flush below
      // is what guarantees it reaches the card, not the severity.
      LOG_I("BLE", "reset requested");
      logger.flush();  // the reboot is imminent; do not lose the reason
      delay(100);
      ESP.restart();
      break;

    default:
      LOG_W("BLE", "unknown command 0x%02X", cmd);
      break;
  }
}

// ===== Periodic clock sync exchange (VTX v1.2) =====

bool BLEManager::requestPhoneTime() {
  if (!_connected) return false;
  if (_timeReqPending || _timeRespReady) return false;  // one in flight at a time

  // [0xF0][t1 uint32] on the file-list characteristic. t1 is echoed to the
  // phone only for debugging; the device keeps the authoritative copy.
  uint8_t buf[5];
  buf[0] = NOTIFY_TIME_REQUEST;

  // Stamp t1 as late as possible — immediately before handing the packet to
  // the stack — so stack-side queuing lands inside the measured RTT rather
  // than before it.
  _timeReqT1 = millis();
  memcpy(buf + 1, &_timeReqT1, 4);
  _timeReqPending = true;

  _fileListChar->setValue(buf, sizeof(buf));
  _fileListChar->notify();
  return true;
}

bool BLEManager::isTimeRequestPending() const {
  return _timeReqPending;
}

bool BLEManager::pollTimeResponse(uint32_t& t1, uint32_t& t4, int64_t& t2, int64_t& t3) {
  if (!_timeRespReady) return false;

  t1 = _timeReqT1;
  t4 = _timeRespT4;
  t2 = _timeRespT2;
  t3 = _timeRespT3;

  _timeRespReady = false;
  return true;
}

bool BLEManager::expireStaleTimeRequest() {
  if (!_timeReqPending) return false;
  if (millis() - _timeReqT1 < CLOCK_SYNC_TIMEOUT_MS) return false;

  // A missed sync is not an error — the phone is usually away during a ride.
  _timeReqPending = false;
  return true;
}

// ===== Diagnostic log readout =====

// Reply layout, on the file-list characteristic:
//   [0xF1][next_pos u64][gap u64][total_written u64][min_level u8][len u8][text]
//
// `gap` is the number of bytes overwritten before this reader saw them. It is
// reported rather than silently skipped — same principle as dropped-sample
// handling in timestamp_reconstruction: flag the loss, do not paper over it.
// The app shows it as "N bytes of log lost" instead of presenting a clean but
// incomplete history.
void BLEManager::sendLogChunk(LogManager& log) {
  if (!_connected) return;

  // Size the chunk from what this peer actually negotiated. getPeerMTU()
  // returns the BLE default (23) before the exchange completes and 0 if the
  // connection id is unknown, so clamp into [MIN, MAX] rather than trusting it
  // — an over-large notification is silently truncated by the stack, which
  // would corrupt the text without any error surfacing.
  int chunk = LOG_BLE_CHUNK_MIN;
  if (_server) {
    const uint16_t mtu = _server->getPeerMTU(_server->getConnId());
    if (mtu > 3) {
      const int usable = (int)mtu - 3 - LOG_BLE_PREAMBLE;
      if (usable > chunk) chunk = usable;
    }
  }
  if (chunk > LOG_BLE_CHUNK_MAX) chunk = LOG_BLE_CHUNK_MAX;

  uint8_t text[LOG_BLE_CHUNK_MAX];
  uint64_t gap = 0;
  const int n = log.readFrom(_logReaderPos, text, chunk, gap);

  uint8_t buf[LOG_BLE_PREAMBLE + LOG_BLE_CHUNK_MAX];
  int off = 0;
  buf[off++] = NOTIFY_LOG_DATA;
  memcpy(buf + off, &_logReaderPos, 8); off += 8;
  memcpy(buf + off, &gap, 8);           off += 8;
  const uint64_t total = log.getTotalWritten();
  memcpy(buf + off, &total, 8);         off += 8;
  buf[off++] = log.getMinLevel();
  buf[off++] = (uint8_t)n;
  if (n > 0) {
    memcpy(buf + off, text, (size_t)n);
    off += n;
  }

  _fileListChar->setValue(buf, off);
  _fileListChar->notify();

  if (gap > 0) {
    LOG_W("LOG", "reader lapped, %llu bytes lost", (unsigned long long)gap);
  }
}

// Position and level with no payload — lets the app show how much log is
// waiting, and resume, without pulling any of it.
void BLEManager::sendLogStatus(LogManager& log) {
  if (!_connected) return;

  uint8_t buf[LOG_BLE_PREAMBLE];
  int off = 0;
  buf[off++] = NOTIFY_LOG_DATA;
  const uint64_t pos = _logReaderPosValid ? _logReaderPos : 0;
  memcpy(buf + off, &pos, 8); off += 8;
  const uint64_t gap = 0;
  memcpy(buf + off, &gap, 8); off += 8;
  const uint64_t total = log.getTotalWritten();
  memcpy(buf + off, &total, 8); off += 8;
  buf[off++] = log.getMinLevel();
  buf[off++] = 0;  // no text

  _fileListChar->setValue(buf, off);
  _fileListChar->notify();
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

  // Flags: bit0 = SD OK, bit1 = IMU OK, bit2 = space low, bit3 = space critical.
  // Derived from freeMb, which the caller already computed — no extra FAT walk,
  // and no new parameters threaded through every call site.
  const bool spaceLow = sdOk && freeMb < SD_WARN_MB;
  const bool spaceCritical = sdOk && freeMb < SD_CRITICAL_MB;
  buf[8] = (sdOk ? 0x01 : 0x00) | (imuOk ? 0x02 : 0x00)
         | (spaceLow ? 0x04 : 0x00) | (spaceCritical ? 0x08 : 0x00);

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
