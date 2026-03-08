/*
 * WiFi Upload Manager Implementation
 *
 * Non-blocking state machine for uploading .vtx files to server.
 * Streams file data via raw WiFiClient sockets.
 */

#include "wifi_manager.h"
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
    _fileRemaining(0) {
  _ssid[0] = '\0';
  _password[0] = '\0';
  _userId[0] = '\0';
  _apiKey[0] = '\0';
  _serverUrl[0] = '\0';
  memset(&_progress, 0, sizeof(_progress));
}

void WiFiUploadManager::init() {
  loadCredentials();
  Serial.printf("[WiFi] Credentials loaded — SSID: '%s', user: '%s', server: '%s'\n",
                _ssid, _userId, _serverUrl);
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

  Serial.printf("[WiFi] Saved WiFi credentials — SSID: '%s'\n", _ssid);
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

  Serial.printf("[WiFi] Saved user credentials — user: '%s', server: '%s'\n", _userId, _serverUrl);
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
    Serial.println("[WiFi] Sync already in progress");
    return;
  }

  if (!hasCredentials()) {
    Serial.printf("[WiFi] Missing credentials — SSID:'%s' user:'%s' key:'%s' server:'%s'\n",
                  _ssid, _userId, _apiKey, _serverUrl);
    _state = WIFI_ERROR;
    _stateEnteredAt = millis();
    return;
  }

  // Build file list
  FileEntry entries[MAX_UPLOAD_FILES];
  _fileCount = storage.listFiles(entries, MAX_UPLOAD_FILES);

  if (_fileCount == 0) {
    Serial.println("[WiFi] No files to upload");
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

  Serial.printf("[WiFi] Starting sync — %d files, connecting to '%s'...\n", _fileCount, _ssid);
}

void WiFiUploadManager::cancelSync() {
  if (_state == WIFI_IDLE) return;
  Serial.println("[WiFi] Sync cancelled");

  // Clean up any in-progress file upload
  if (_activeClient || _uploadBuf) {
    // Need a StorageManager ref to close the file — but we can just clean up our side
    if (_activeClient) {
      _activeClient->stop();
      if (_clientIsSSL)
        delete static_cast<WiFiClientSecure*>(_activeClient);
      else
        delete static_cast<WiFiClient*>(_activeClient);
      _activeClient = nullptr;
    }
    if (_uploadBuf) {
      free(_uploadBuf);
      _uploadBuf = nullptr;
    }
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
        Serial.printf("[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
        _state = WIFI_CHECK_EXISTING;
        _stateEnteredAt = millis();
        break;
      }

      if (millis() - _stateEnteredAt > WIFI_CONNECT_TIMEOUT_MS) {
        Serial.println("[WiFi] Connection timeout");
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_CHECK_EXISTING: {
      checkExistingFiles();

      // Recalculate bytesTotal excluding skipped files
      // and advance to first non-skipped file
      _state = WIFI_NEXT_FILE;
      _currentFileIndex = -1;  // NEXT_FILE will increment to 0
      _stateEnteredAt = millis();
      break;
    }

    case WIFI_UPLOADING: {
      // Open file, connect to server, send HTTP headers
      const char* filename = _fileNames[_currentFileIndex];
      _progress.currentFile = (uint8_t)(_currentFileIndex + 1);

      Serial.printf("[WiFi] Uploading file %d/%d: %s\n",
                    _currentFileIndex + 1, _fileCount, filename);

      if (beginFileUpload(storage, filename)) {
        _state = WIFI_STREAMING;
        _stateEnteredAt = millis();
      } else {
        Serial.printf("[WiFi] Upload setup failed: %s\n", filename);
        endFileUpload(storage);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_STREAMING: {
      // Stream one chunk per tick — returns to main loop between chunks
      // so BLE status pushes can fire
      if (_fileRemaining > 0) {
        if (!streamNextChunk(storage)) {
          Serial.println("[WiFi] Stream error");
          endFileUpload(storage);
          disconnectWiFi();
          _state = WIFI_ERROR;
          _stateEnteredAt = millis();
        }
      } else {
        // File data done — send multipart footer
        _activeClient->print(_partFooter);
        _state = WIFI_WAIT_RESPONSE;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_WAIT_RESPONSE: {
      bool success = readResponse();
      endFileUpload(storage);

      if (success) {
        Serial.printf("[WiFi] Upload complete: %s\n", _fileNames[_currentFileIndex]);
        _fileSkip[_currentFileIndex] = true;  // Mark as synced
        _state = WIFI_NEXT_FILE;
        _stateEnteredAt = millis();
      } else {
        Serial.printf("[WiFi] Upload failed: %s\n", _fileNames[_currentFileIndex]);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_NEXT_FILE: {
      _currentFileIndex++;
      // Skip files that already exist on server
      while (_currentFileIndex < _fileCount && _fileSkip[_currentFileIndex]) {
        Serial.printf("[WiFi] Skipping %s (already on server)\n", _fileNames[_currentFileIndex]);
        _currentFileIndex++;
      }
      if (_currentFileIndex >= _fileCount) {
        _state = WIFI_DONE;
        _stateEnteredAt = millis();
      } else {
        _state = WIFI_UPLOADING;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_DONE:
      Serial.printf("[WiFi] Sync complete — %d files uploaded\n", _fileCount);
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

void WiFiUploadManager::disconnectWiFi() {
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  Serial.println("[WiFi] Disconnected");
}

bool WiFiUploadManager::checkExistingFiles() {
  // Build comma-separated filename list for query param
  String filenames;
  for (int i = 0; i < _fileCount; i++) {
    if (i > 0) filenames += ",";
    filenames += _fileNames[i];
  }

  String host;
  int port;
  bool useSSL;
  parseServerUrl(host, port, useSSL);

  // Build query path
  String path = "/api/upload/device?filenames=" + filenames;

  Serial.printf("[WiFi] Checking existing files on %s:%d\n", host.c_str(), port);

  Client* client;
  WiFiClientSecure* sslClient = nullptr;
  WiFiClient* plainClient = nullptr;

  if (useSSL) {
    sslClient = new WiFiClientSecure();
    sslClient->setInsecure();
    if (!sslClient->connect(host.c_str(), port)) {
      Serial.println("[WiFi] Check connection failed");
      delete sslClient;
      return false;
    }
    client = sslClient;
  } else {
    plainClient = new WiFiClient();
    if (!plainClient->connect(host.c_str(), port)) {
      Serial.println("[WiFi] Check connection failed");
      delete plainClient;
      return false;
    }
    client = plainClient;
  }

  // Send GET request
  client->printf("GET %s HTTP/1.1\r\n", path.c_str());
  client->printf("Host: %s\r\n", host.c_str());
  client->printf("X-Device-Key: %s\r\n", _apiKey);
  client->printf("X-User-Id: %s\r\n", _userId);
  client->print("Connection: close\r\n\r\n");

  // Read response
  unsigned long respStart = millis();
  while (!client->available() && millis() - respStart < 10000) {
    delay(10);
  }

  // Skip status line and headers, then read body
  // Next.js uses chunked transfer encoding: headers, blank line, chunk size, JSON body
  bool headersEnd = false;
  String body;
  while (client->available() || millis() - respStart < 5000) {
    if (client->available()) {
      String line = client->readStringUntil('\n');
      line.trim();
      if (!headersEnd) {
        if (line.length() == 0) headersEnd = true;
      } else {
        // Skip chunked encoding size lines (hex digits only) and empty lines
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
  if (sslClient) delete sslClient;
  if (plainClient) delete plainClient;

  if (body.length() == 0) {
    Serial.println("[WiFi] No response body from check");
    return false;
  }

  Serial.printf("[WiFi] Existing files response: %s\n", body.c_str());

  // Parse the "existing" array from JSON response
  // Simple parsing: look for each filename in the response body
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
    Serial.printf("[WiFi] %d/%d files already on server, skipping (%lu bytes)\n",
                  skipped, _fileCount, (unsigned long)skippedBytes);
  }

  return true;
}

void WiFiUploadManager::parseServerUrl(String& host, int& port, bool& useSSL) {
  String serverStr(_serverUrl);
  useSSL = false;
  port = 80;

  if (serverStr.startsWith("https://")) {
    serverStr = serverStr.substring(8);
    useSSL = true;
    port = 443;
  } else if (serverStr.startsWith("http://")) {
    serverStr = serverStr.substring(7);
  }

  int colonIdx = serverStr.indexOf(':');
  int slashIdx = serverStr.indexOf('/');
  if (colonIdx > 0 && (slashIdx < 0 || colonIdx < slashIdx)) {
    host = serverStr.substring(0, colonIdx);
    if (slashIdx > 0) {
      port = serverStr.substring(colonIdx + 1, slashIdx).toInt();
    } else {
      port = serverStr.substring(colonIdx + 1).toInt();
    }
  } else if (slashIdx > 0) {
    host = serverStr.substring(0, slashIdx);
  } else {
    host = serverStr;
  }
}

bool WiFiUploadManager::beginFileUpload(StorageManager& storage, const char* filename) {
  if (!storage.openFileForRead(filename)) {
    Serial.printf("[WiFi] Failed to open file: %s\n", filename);
    return false;
  }

  uint32_t fileSize = storage.getOpenFileSize();

  _uploadBuf = (uint8_t*)malloc(WIFI_UPLOAD_CHUNK_SIZE);
  if (!_uploadBuf) {
    Serial.println("[WiFi] Failed to allocate upload buffer");
    storage.closeReadFile();
    return false;
  }

  String host;
  int port;
  bool useSSL;
  parseServerUrl(host, port, useSSL);

  Serial.printf("[WiFi] Connecting to %s:%d (SSL=%d)\n", host.c_str(), port, useSSL);

  // Create heap-allocated client so it persists across tick() calls
  if (useSSL) {
    WiFiClientSecure* sslClient = new WiFiClientSecure();
    sslClient->setInsecure();  // TODO: cert pinning for production
    if (!sslClient->connect(host.c_str(), port)) {
      Serial.println("[WiFi] SSL connection failed");
      delete sslClient;
      return false;
    }
    _activeClient = sslClient;
    _clientIsSSL = true;
  } else {
    WiFiClient* client = new WiFiClient();
    if (!client->connect(host.c_str(), port)) {
      Serial.println("[WiFi] Connection failed");
      delete client;
      return false;
    }
    _activeClient = client;
    _clientIsSSL = false;
  }

  // Build and send HTTP headers + multipart header
  String boundary = "----VertexUpload";
  String partHeader = "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"file\"; filename=\"" + String(filename) + "\"\r\n"
    "Content-Type: application/octet-stream\r\n\r\n";
  _partFooter = "\r\n--" + boundary + "--\r\n";
  uint32_t contentLength = partHeader.length() + fileSize + _partFooter.length();

  _activeClient->printf("POST /api/upload/device HTTP/1.1\r\n");
  _activeClient->printf("Host: %s\r\n", host.c_str());
  _activeClient->printf("X-Device-Key: %s\r\n", _apiKey);
  _activeClient->printf("X-User-Id: %s\r\n", _userId);
  _activeClient->printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary.c_str());
  _activeClient->printf("Content-Length: %lu\r\n", (unsigned long)contentLength);
  _activeClient->print("Connection: close\r\n\r\n");
  _activeClient->print(partHeader);

  _fileRemaining = fileSize;
  return true;
}

bool WiFiUploadManager::streamNextChunk(StorageManager& storage) {
  int toRead = min((uint32_t)WIFI_UPLOAD_CHUNK_SIZE, _fileRemaining);
  int bytesRead = storage.readFileChunk(_uploadBuf, toRead);
  if (bytesRead <= 0) return false;

  int written = _activeClient->write(_uploadBuf, bytesRead);
  if (written != bytesRead) {
    Serial.printf("[WiFi] Write error: %d/%d\n", written, bytesRead);
    return false;
  }

  _fileRemaining -= bytesRead;
  _progress.bytesSent += bytesRead;
  return true;
}

bool WiFiUploadManager::readResponse() {
  // Wait for response (blocking, but should be fast after upload)
  unsigned long respStart = millis();
  while (!_activeClient->available() && millis() - respStart < 30000) {
    delay(10);
  }

  String statusLine = _activeClient->readStringUntil('\n');
  Serial.printf("[WiFi] Response: %s\n", statusLine.c_str());

  // Drain headers, print first body line
  bool headersEnd = false;
  while (_activeClient->available() || millis() - respStart < 5000) {
    if (_activeClient->available()) {
      String line = _activeClient->readStringUntil('\n');
      if (!headersEnd) {
        if (line == "\r" || line.length() == 0) headersEnd = true;
      } else {
        Serial.printf("[WiFi] Body: %s\n", line.c_str());
        break;
      }
    } else {
      delay(10);
    }
  }

  return statusLine.indexOf("200") > 0;
}

void WiFiUploadManager::endFileUpload(StorageManager& storage) {
  storage.closeReadFile();

  if (_activeClient) {
    _activeClient->stop();
    if (_clientIsSSL)
      delete static_cast<WiFiClientSecure*>(_activeClient);
    else
      delete static_cast<WiFiClient*>(_activeClient);
    _activeClient = nullptr;
  }

  if (_uploadBuf) {
    free(_uploadBuf);
    _uploadBuf = nullptr;
  }
}
