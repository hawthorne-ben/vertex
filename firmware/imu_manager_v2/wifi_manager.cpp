/*
 * WiFi Upload Manager — Presigned URL direct-to-Supabase upload
 *
 * Flow per file:
 *   1. POST /api/upload/device/presign → {url, token, storagePath}
 *   2. PUT raw bytes to Supabase signed URL
 *   3. POST /api/upload/device/complete → server creates DB record
 *
 * Non-blocking state machine driven by tick() in loop().
 */

#include "wifi_manager.h"
#include "log_manager.h"
#include "storage_manager.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>

WiFiUploadManager::WiFiUploadManager()
  : _state(WIFI_IDLE),
    _stateEnteredAt(0),
    _fileCount(0),
    _currentFileIndex(0),
    _activeClient(nullptr),
    _clientIsSSL(false),
    _uploadBuf(nullptr),
    _fileRemaining(0),
    _responseSuccess(false) {
  _ssid[0] = '\0';
  _password[0] = '\0';
  _userId[0] = '\0';
  _apiKey[0] = '\0';
  _serverUrl[0] = '\0';
  memset(&_progress, 0, sizeof(_progress));
}

void WiFiUploadManager::init() {
  loadCredentials();
  // Presence, not values. The ring is on removable media and is read out over
  // a GATT service with no pairing or encryption, so credentials must not
  // reach it. Whether they are set is the diagnostic; what they are is not.
  LOG_I("WIFI", "credentials loaded — wifi:%s user:%s server:%s",
                _ssid[0] ? "yes" : "no",
                _userId[0] ? "yes" : "no",
                _serverUrl[0] ? "yes" : "no");
}

void WiFiUploadManager::loadCredentials() {
  Preferences prefs;
  prefs.begin("wifi", true);  // read-only
  prefs.getString("ssid", _ssid, sizeof(_ssid));
  prefs.getString("pass", _password, sizeof(_password));
  prefs.end();

  prefs.begin("user", true);
  prefs.getString("userId", _userId, sizeof(_userId));
  prefs.getString("apiKey", _apiKey, sizeof(_apiKey));
  prefs.getString("server", _serverUrl, sizeof(_serverUrl));
  prefs.end();
}

bool WiFiUploadManager::hasCredentials() const {
  return strlen(_ssid) > 0 && strlen(_userId) > 0
      && strlen(_apiKey) > 0 && strlen(_serverUrl) > 0;
}

void WiFiUploadManager::saveWiFiCredentials(const char* ssid, const char* password) {
  Preferences prefs;
  prefs.begin("wifi", false);
  prefs.putString("ssid", ssid);
  prefs.putString("pass", password);
  prefs.end();

  strncpy(_ssid, ssid, sizeof(_ssid) - 1);
  _ssid[sizeof(_ssid) - 1] = '\0';
  strncpy(_password, password, sizeof(_password) - 1);
  _password[sizeof(_password) - 1] = '\0';

  LOG_I("WIFI", "saved WiFi credentials (%u char SSID)", (unsigned)strlen(_ssid));
}

void WiFiUploadManager::saveUserCredentials(const char* userId, const char* apiKey, const char* serverUrl) {
  Preferences prefs;
  prefs.begin("user", false);
  prefs.putString("userId", userId);
  prefs.putString("apiKey", apiKey);
  prefs.putString("server", serverUrl);
  prefs.end();

  strncpy(_userId, userId, sizeof(_userId) - 1);
  _userId[sizeof(_userId) - 1] = '\0';
  strncpy(_apiKey, apiKey, sizeof(_apiKey) - 1);
  _apiKey[sizeof(_apiKey) - 1] = '\0';
  strncpy(_serverUrl, serverUrl, sizeof(_serverUrl) - 1);
  _serverUrl[sizeof(_serverUrl) - 1] = '\0';

  LOG_I("WIFI", "saved user credentials — server host: %s", _serverUrl[0] ? "set" : "unset");
}

bool WiFiUploadManager::isFileSynced(const char* filename) const {
  for (int i = 0; i < _fileCount; i++) {
    if (strcmp(_fileNames[i], filename) == 0 && _fileSkip[i]) {
      return true;
    }
  }
  return false;
}

void WiFiUploadManager::startSync(StorageManager& storage) {
  if (_state != WIFI_IDLE) {
    LOG_W("WIFI", "sync already in progress");
    return;
  }

  if (!hasCredentials()) {
    LOG_W("WIFI", "missing credentials — SSID:'%s' user:'%s' key:'%s' server:'%s'",
                  _ssid, _userId, _apiKey, _serverUrl);
    _state = WIFI_ERROR;
    _stateEnteredAt = millis();
    return;
  }

  // Build file list
  FileEntry entries[MAX_UPLOAD_FILES];
  _fileCount = storage.listFiles(entries, MAX_UPLOAD_FILES);

  if (_fileCount == 0) {
    LOG_I("WIFI", "no files to upload");
    _state = WIFI_DONE;
    _stateEnteredAt = millis();
    return;
  }

  uint32_t totalBytes = 0;
  for (int i = 0; i < _fileCount; i++) {
    strncpy(_fileNames[i], entries[i].name, sizeof(_fileNames[i]) - 1);
    _fileNames[i][sizeof(_fileNames[i]) - 1] = '\0';
    _fileSizes[i] = entries[i].size;
    totalBytes += entries[i].size;
  }

  _currentFileIndex = 0;
  _progress.currentFile = 0;
  _progress.totalFiles = (uint8_t)_fileCount;
  _progress.bytesSent = 0;
  _progress.bytesTotal = totalBytes;
  _progress.result = SYNC_RESULT_IN_PROGRESS;
  memset(_fileSkip, 0, sizeof(_fileSkip));

  _state = WIFI_CONNECTING;
  _stateEnteredAt = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(_ssid, _password);

  LOG_I("WIFI", "starting sync — %d files", _fileCount);
}

void WiFiUploadManager::cancelSync() {
  if (_state == WIFI_IDLE) return;
  LOG_I("WIFI", "sync cancelled");

  deleteClient();
  if (_uploadBuf) {
    free(_uploadBuf);
    _uploadBuf = nullptr;
  }

  disconnectWiFi();
  _state = WIFI_IDLE;
}

bool WiFiUploadManager::tick(StorageManager& storage) {
  switch (_state) {
    case WIFI_IDLE:
      return false;

    case WIFI_CONNECTING: {
      if (WiFi.status() == WL_CONNECTED) {
        LOG_I("WIFI", "connected — IP %s", WiFi.localIP().toString().c_str());
        _state = WIFI_CHECK_EXISTING;
        _stateEnteredAt = millis();
        break;
      }

      if (millis() - _stateEnteredAt > WIFI_CONNECT_TIMEOUT_MS) {
        LOG_W("WIFI", "connection timeout after %d ms", WIFI_CONNECT_TIMEOUT_MS);
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_CHECK_EXISTING: {
      checkExistingFiles();
      _state = WIFI_NEXT_FILE;
      _currentFileIndex = -1;  // NEXT_FILE will increment to 0
      _stateEnteredAt = millis();
      break;
    }

    case WIFI_PRESIGN: {
      const char* filename = _fileNames[_currentFileIndex];
      uint32_t fileSize = _fileSizes[_currentFileIndex];
      _progress.currentFile = (uint8_t)(_currentFileIndex + 1);

      LOG_I("WIFI", "requesting presigned URL for %s (%lu bytes)",
                    filename, (unsigned long)fileSize);

      if (requestPresignedUrl(filename, fileSize)) {
        _state = WIFI_STREAMING;
        _stateEnteredAt = millis();

        // Open file and begin PUT to Supabase
        if (!beginDirectUpload(storage, filename)) {
          LOG_E("WIFI", "failed to begin upload: %s", filename);
          endFileUpload(storage);
          disconnectWiFi();
          _state = WIFI_ERROR;
          _stateEnteredAt = millis();
        }
      } else {
        LOG_E("WIFI", "presign failed: %s", filename);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_STREAMING: {
      // Stream chunks in a time-budgeted loop
      unsigned long streamStart = millis();
      while (_fileRemaining > 0 && (millis() - streamStart) < WIFI_STREAM_BUDGET_MS) {
        if (!streamNextChunk(storage)) {
          LOG_E("WIFI", "stream error — upload aborted mid-file");
          endFileUpload(storage);
          disconnectWiFi();
          _state = WIFI_ERROR;
          _stateEnteredAt = millis();
          break;
        }
      }
      if (_state == WIFI_STREAMING && _fileRemaining == 0) {
        // All bytes sent, wait for response
        _state = WIFI_WAIT_RESPONSE;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_WAIT_RESPONSE: {
      if (!readResponse()) break;  // Still waiting — yield back to loop()

      endFileUpload(storage);

      if (_responseSuccess) {
        LOG_I("WIFI", "PUT complete: %s", _fileNames[_currentFileIndex]);
        _state = WIFI_COMPLETE;
        _stateEnteredAt = millis();
      } else {
        LOG_E("WIFI", "PUT failed: %s", _fileNames[_currentFileIndex]);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_COMPLETE: {
      const char* filename = _fileNames[_currentFileIndex];
      uint32_t fileSize = _fileSizes[_currentFileIndex];

      if (notifyComplete(filename, fileSize)) {
        LOG_I("WIFI", "complete notified: %s", filename);
        _fileSkip[_currentFileIndex] = true;
        _state = WIFI_NEXT_FILE;
        _stateEnteredAt = millis();
      } else {
        // ERROR: the object is in storage but the server was never told, so
    // the recording is invisible in the app despite a successful upload.
    LOG_E("WIFI", "complete notification failed: %s", filename);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_NEXT_FILE: {
      _currentFileIndex++;
      while (_currentFileIndex < _fileCount && _fileSkip[_currentFileIndex]) {
        LOG_I("WIFI", "skipping %s (already on server)", _fileNames[_currentFileIndex]);
        _currentFileIndex++;
      }
      if (_currentFileIndex >= _fileCount) {
        _state = WIFI_DONE;
        _stateEnteredAt = millis();
      } else {
        _state = WIFI_PRESIGN;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_DONE:
      LOG_I("WIFI", "sync complete — %d files uploaded", _fileCount);
      _progress.result = SYNC_RESULT_SUCCESS;
      disconnectWiFi();
      _state = WIFI_IDLE;
      return false;

    case WIFI_ERROR:
      _progress.result = SYNC_RESULT_ERROR;
      if (millis() - _stateEnteredAt > 3000) {
        _state = WIFI_IDLE;
        return false;
      }
      break;
  }

  return _state != WIFI_IDLE;
}

// ─── URL Parsing ───────────────────────────────────────────────────────────────

/* static */
void WiFiUploadManager::parseUrl(const String& url, String& host, int& port, String& path, bool& useSSL) {
  String s = url;
  useSSL = false;
  port = 80;

  if (s.startsWith("https://")) {
    s = s.substring(8);
    useSSL = true;
    port = 443;
  } else if (s.startsWith("http://")) {
    s = s.substring(7);
  }

  int slashIdx = s.indexOf('/');
  String hostPort;
  if (slashIdx > 0) {
    hostPort = s.substring(0, slashIdx);
    path = s.substring(slashIdx);
  } else {
    hostPort = s;
    path = "/";
  }

  int colonIdx = hostPort.indexOf(':');
  if (colonIdx > 0) {
    host = hostPort.substring(0, colonIdx);
    port = hostPort.substring(colonIdx + 1).toInt();
  } else {
    host = hostPort;
  }
}

// ─── Client Management ────────────────────────────────────────────────────────

Client* WiFiUploadManager::connectClient(const String& host, int port, bool useSSL) {
  if (useSSL) {
    WiFiClientSecure* ssl = new WiFiClientSecure();
    ssl->setInsecure();  // Skip cert verification (ESP32 has limited CA store)
    if (!ssl->connect(host.c_str(), port)) {
      LOG_W("WIFI", "SSL connect failed: %s:%d", host.c_str(), port);
      delete ssl;
      return nullptr;
    }
    return ssl;
  } else {
    WiFiClient* plain = new WiFiClient();
    if (!plain->connect(host.c_str(), port)) {
      LOG_W("WIFI", "connect failed: %s:%d", host.c_str(), port);
      delete plain;
      return nullptr;
    }
    return plain;
  }
}

void WiFiUploadManager::deleteClient() {
  if (_activeClient) {
    _activeClient->stop();
    if (_clientIsSSL)
      delete static_cast<WiFiClientSecure*>(_activeClient);
    else
      delete static_cast<WiFiClient*>(_activeClient);
    _activeClient = nullptr;
  }
}

// ─── API Helpers ───────────────────────────────────────────────────────────────

String WiFiUploadManager::apiPost(const char* endpoint, const String& jsonBody) {
  String host;
  int port;
  bool useSSL;
  String path;

  // Parse server URL and append endpoint
  String serverStr(_serverUrl);
  parseUrl(serverStr, host, port, path, useSSL);
  path = String(endpoint);

  Client* client = connectClient(host, port, useSSL);
  if (!client) return "";

  // Send POST
  client->printf("POST %s HTTP/1.1\r\n", path.c_str());
  client->printf("Host: %s\r\n", host.c_str());
  client->printf("X-Device-Key: %s\r\n", _apiKey);
  client->printf("X-User-Id: %s\r\n", _userId);
  client->print("Content-Type: application/json\r\n");
  client->printf("Content-Length: %d\r\n", jsonBody.length());
  client->print("Connection: close\r\n\r\n");
  client->print(jsonBody);

  // Wait for response
  unsigned long respStart = millis();
  while (!client->available() && millis() - respStart < 15000) {
    delay(10);
  }

  // Read status line
  String statusLine = client->readStringUntil('\n');
  LOG_D("WIFI", "API %s → %s", endpoint, statusLine.c_str());

  // Skip headers, read body
  bool headersEnd = false;
  String body;
  while (client->available() || millis() - respStart < 10000) {
    if (client->available()) {
      String line = client->readStringUntil('\n');
      line.trim();
      if (!headersEnd) {
        if (line.length() == 0) headersEnd = true;
      } else {
        // Skip chunked encoding size lines
        if (line.length() > 0 && line.startsWith("{")) {
          body = line;
          break;
        }
      }
    } else {
      delay(10);
    }
  }

  client->stop();
  // Delete client — figure out type from SSL flag
  if (useSSL)
    delete static_cast<WiFiClientSecure*>(client);
  else
    delete static_cast<WiFiClient*>(client);

  return body;
}

// ─── Presigned URL Request ─────────────────────────────────────────────────────

bool WiFiUploadManager::requestPresignedUrl(const char* filename, uint32_t fileSize) {
  String json = "{\"filename\":\"" + String(filename) + "\",\"fileSize\":" + String(fileSize) + "}";

  String body = apiPost("/api/upload/device/presign", json);
  if (body.length() == 0) {
    LOG_W("WIFI", "no response from presign");
    return false;
  }

  // The presign response carries the signed upload URL. That URL is a bearer
  // credential — anyone holding it can write to the bucket until it expires —
  // so log its size, never its contents.
  LOG_D("WIFI", "presign response: %u bytes", (unsigned)body.length());

  // Parse "url" and "storagePath" from JSON response
  auto extractJsonString = [&](const char* key, String& out) -> bool {
    String search = String("\"") + key + "\":\"";
    int idx = body.indexOf(search);
    if (idx < 0) return false;
    int start = idx + search.length();
    // Find closing quote, skipping escaped quotes
    int end = start;
    while (end < (int)body.length()) {
      if (body[end] == '\\') { end += 2; continue; }
      if (body[end] == '"') break;
      end++;
    }
    if (end >= (int)body.length()) return false;
    out = body.substring(start, end);
    return out.length() > 0;
  };

  if (!extractJsonString("url", _uploadUrl)) {
    LOG_W("WIFI", "no url in presign response");
    return false;
  }
  if (!extractJsonString("storagePath", _storagePath)) {
    LOG_W("WIFI", "no storagePath in presign response");
    return false;
  }

  LOG_D("WIFI", "upload URL received (%u chars)", (unsigned)_uploadUrl.length());
  LOG_D("WIFI", "storage path: %s", _storagePath.c_str());

  return true;
}

// ─── Direct Upload to Supabase ─────────────────────────────────────────────────

bool WiFiUploadManager::beginDirectUpload(StorageManager& storage, const char* filename) {
  if (!storage.openFileForRead(filename)) {
    LOG_E("WIFI", "failed to open file: %s", filename);
    return false;
  }

  uint32_t fileSize = storage.getOpenFileSize();

  _uploadBuf = (uint8_t*)malloc(WIFI_UPLOAD_CHUNK_SIZE);
  if (!_uploadBuf) {
    LOG_E("WIFI", "failed to allocate upload buffer (%d bytes)", WIFI_UPLOAD_CHUNK_SIZE);
    storage.closeReadFile();
    return false;
  }

  // Parse the presigned URL to get host, port, path
  String host, path;
  int port;
  bool useSSL;
  parseUrl(_uploadUrl, host, port, path, useSSL);

  LOG_D("WIFI", "PUT to %s:%d%s (SSL=%d)", host.c_str(), port, path.c_str(), useSSL);

  Client* client = connectClient(host, port, useSSL);
  if (!client) {
    free(_uploadBuf);
    _uploadBuf = nullptr;
    storage.closeReadFile();
    return false;
  }

  _activeClient = client;
  _clientIsSSL = useSSL;

  // Send PUT headers — raw binary body, no multipart
  _activeClient->printf("PUT %s HTTP/1.1\r\n", path.c_str());
  _activeClient->printf("Host: %s\r\n", host.c_str());
  _activeClient->print("Content-Type: application/octet-stream\r\n");
  _activeClient->printf("Content-Length: %lu\r\n", (unsigned long)fileSize);
  _activeClient->print("Connection: close\r\n\r\n");

  _fileRemaining = fileSize;
  return true;
}

// ─── Stream Chunk ──────────────────────────────────────────────────────────────

bool WiFiUploadManager::streamNextChunk(StorageManager& storage) {
  int toRead = min((uint32_t)WIFI_UPLOAD_CHUNK_SIZE, _fileRemaining);
  int bytesRead = storage.readFileChunk(_uploadBuf, toRead);
  if (bytesRead <= 0) return false;

  int written = _activeClient->write(_uploadBuf, bytesRead);
  if (written != bytesRead) {
    LOG_E("WIFI", "write error: %d/%d bytes", (int)written, (int)bytesRead);
    return false;
  }

  _fileRemaining -= bytesRead;
  _progress.bytesSent += bytesRead;
  return true;
}

// ─── Read HTTP Response ────────────────────────────────────────────────────────

// Non-blocking: returns true when a response has been received (success or fail),
// false when still waiting. Caller checks _responseSuccess for the result.
// _stateEnteredAt is used as the timeout reference (set when WIFI_WAIT_RESPONSE entered).
bool WiFiUploadManager::readResponse() {
  if (!_activeClient->available()) {
    if (millis() - _stateEnteredAt > 30000) {
      LOG_W("WIFI", "response timeout");
      _responseSuccess = false;
      return true;  // Done — timed out
    }
    return false;  // Still waiting — yield back to loop()
  }

  String statusLine = _activeClient->readStringUntil('\n');
  LOG_D("WIFI", "response: %s", statusLine.c_str());

  // Drain headers + body (data is already available, so this won't block)
  bool headersEnd = false;
  unsigned long drainStart = millis();
  while (_activeClient->available() || millis() - drainStart < 2000) {
    if (_activeClient->available()) {
      String line = _activeClient->readStringUntil('\n');
      if (!headersEnd) {
        if (line == "\r" || line.length() == 0) headersEnd = true;
      } else {
        LOG_D("WIFI", "body: %s", line.c_str());
        break;
      }
    } else {
      delay(10);
    }
  }

  _responseSuccess = statusLine.indexOf("200") > 0 || statusLine.indexOf("201") > 0;
  return true;  // Done
}

// ─── Complete Notification ─────────────────────────────────────────────────────

bool WiFiUploadManager::notifyComplete(const char* filename, uint32_t fileSize) {
  String json = "{\"filename\":\"" + String(filename)
    + "\",\"storagePath\":\"" + _storagePath
    + "\",\"fileSize\":" + String(fileSize) + "}";

  String body = apiPost("/api/upload/device/complete", json);
  if (body.length() == 0) {
    LOG_W("WIFI", "no response from complete");
    return false;
  }

  LOG_D("WIFI", "complete response: %s", body.c_str());

  return body.indexOf("\"success\":true") >= 0;
}

// ─── Cleanup ───────────────────────────────────────────────────────────────────

void WiFiUploadManager::endFileUpload(StorageManager& storage) {
  storage.closeReadFile();
  deleteClient();

  if (_uploadBuf) {
    free(_uploadBuf);
    _uploadBuf = nullptr;
  }
}

// ─── Check Existing Files ──────────────────────────────────────────────────────

bool WiFiUploadManager::checkExistingFiles() {
  // Build comma-separated filename list
  String filenames;
  for (int i = 0; i < _fileCount; i++) {
    if (i > 0) filenames += ",";
    filenames += _fileNames[i];
  }

  String host, path;
  int port;
  bool useSSL;
  String serverStr(_serverUrl);
  parseUrl(serverStr, host, port, path, useSSL);

  String reqPath = "/api/upload/device?filenames=" + filenames;
  LOG_I("WIFI", "checking existing files on %s:%d", host.c_str(), port);

  Client* client = connectClient(host, port, useSSL);
  if (!client) return false;

  client->printf("GET %s HTTP/1.1\r\n", reqPath.c_str());
  client->printf("Host: %s\r\n", host.c_str());
  client->printf("X-Device-Key: %s\r\n", _apiKey);
  client->printf("X-User-Id: %s\r\n", _userId);
  client->print("Connection: close\r\n\r\n");

  unsigned long respStart = millis();
  while (!client->available() && millis() - respStart < 10000) {
    delay(10);
  }

  bool headersEnd = false;
  String body;
  while (client->available() || millis() - respStart < 5000) {
    if (client->available()) {
      String line = client->readStringUntil('\n');
      line.trim();
      if (!headersEnd) {
        if (line.length() == 0) headersEnd = true;
      } else {
        if (line.length() > 0 && line.startsWith("{")) {
          body = line;
          break;
        }
      }
    } else {
      delay(10);
    }
  }

  client->stop();
  if (useSSL)
    delete static_cast<WiFiClientSecure*>(client);
  else
    delete static_cast<WiFiClient*>(client);

  if (body.length() == 0) {
    LOG_W("WIFI", "no response body from check");
    return false;
  }

  LOG_D("WIFI", "existing files response: %s", body.c_str());

  int skipped = 0;
  uint32_t skippedBytes = 0;
  for (int i = 0; i < _fileCount; i++) {
    if (body.indexOf(_fileNames[i]) >= 0) {
      _fileSkip[i] = true;
      skippedBytes += _fileSizes[i];
      skipped++;
    }
  }

  if (skipped > 0) {
    _progress.bytesTotal -= skippedBytes;
    LOG_I("WIFI", "%d/%d files already on server, skipping (%lu bytes)",
                  skipped, _fileCount, (unsigned long)skippedBytes);
  }

  return true;
}

void WiFiUploadManager::disconnectWiFi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  LOG_I("WIFI", "disconnected");
}
