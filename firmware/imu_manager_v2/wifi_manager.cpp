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
    _currentFileIndex(0) {
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
    totalBytes += entries[i].size;
  }

  _currentFileIndex = 0;
  _progress.currentFile = 0;
  _progress.totalFiles = (uint8_t)_fileCount;
  _progress.bytesSent = 0;
  _progress.bytesTotal = totalBytes;
  _progress.result = SYNC_RESULT_IN_PROGRESS;

  _state = WIFI_CONNECTING;
  _stateEnteredAt = millis();

  WiFi.mode(WIFI_STA);
  WiFi.begin(_ssid, _password);

  Serial.printf("[WiFi] Starting sync — %d files, connecting to '%s'...\n", _fileCount, _ssid);
}

void WiFiUploadManager::cancelSync() {
  if (_state == WIFI_IDLE) return;
  Serial.println("[WiFi] Sync cancelled");
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
        _state = WIFI_UPLOADING;
        _stateEnteredAt = millis();
        break;
      }

      // Timeout
      if (millis() - _stateEnteredAt > WIFI_CONNECT_TIMEOUT_MS) {
        Serial.println("[WiFi] Connection timeout");
        WiFi.disconnect(true);
        WiFi.mode(WIFI_OFF);
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_UPLOADING: {
      const char* filename = _fileNames[_currentFileIndex];
      _progress.currentFile = (uint8_t)(_currentFileIndex + 1);

      Serial.printf("[WiFi] Uploading file %d/%d: %s\n",
                    _currentFileIndex + 1, _fileCount, filename);

      bool ok = uploadFile(storage, filename);
      if (ok) {
        Serial.printf("[WiFi] Upload complete: %s\n", filename);
        _state = WIFI_NEXT_FILE;
        _stateEnteredAt = millis();
      } else {
        Serial.printf("[WiFi] Upload failed: %s\n", filename);
        disconnectWiFi();
        _state = WIFI_ERROR;
        _stateEnteredAt = millis();
      }
      break;
    }

    case WIFI_NEXT_FILE: {
      _currentFileIndex++;
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
      // Wait 3s in error state so BLE can report it, then go idle
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

bool WiFiUploadManager::sendRequest(Client& client, StorageManager& storage,
                                     const char* filename, const String& host,
                                     uint32_t fileSize, uint8_t* buf) {
  String boundary = "----VertexUpload";
  String partHeader = "--" + boundary + "\r\n"
    "Content-Disposition: form-data; name=\"file\"; filename=\"" + String(filename) + "\"\r\n"
    "Content-Type: application/octet-stream\r\n\r\n";
  String partFooter = "\r\n--" + boundary + "--\r\n";
  uint32_t contentLength = partHeader.length() + fileSize + partFooter.length();

  // Send HTTP headers
  client.printf("POST /api/upload/device HTTP/1.1\r\n");
  client.printf("Host: %s\r\n", host.c_str());
  client.printf("X-Device-Key: %s\r\n", _apiKey);
  client.printf("X-User-Id: %s\r\n", _userId);
  client.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary.c_str());
  client.printf("Content-Length: %lu\r\n", (unsigned long)contentLength);
  client.print("Connection: close\r\n\r\n");

  // Multipart header
  client.print(partHeader);

  // Stream file data
  uint32_t remaining = fileSize;
  while (remaining > 0) {
    int toRead = min((uint32_t)WIFI_UPLOAD_CHUNK_SIZE, remaining);
    int bytesRead = storage.readFileChunk(buf, toRead);
    if (bytesRead <= 0) break;

    int written = client.write(buf, bytesRead);
    if (written != bytesRead) {
      Serial.printf("[WiFi] Write error: %d/%d\n", written, bytesRead);
      return false;
    }

    remaining -= bytesRead;
    _progress.bytesSent += bytesRead;
  }

  // Multipart footer
  client.print(partFooter);

  // Read response status line
  unsigned long respStart = millis();
  while (!client.available() && millis() - respStart < 30000) {
    delay(10);
  }

  String statusLine = client.readStringUntil('\n');
  Serial.printf("[WiFi] Response: %s\n", statusLine.c_str());

  // Drain headers, print first body line
  bool headersEnd = false;
  while (client.available() || millis() - respStart < 5000) {
    if (client.available()) {
      String line = client.readStringUntil('\n');
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

bool WiFiUploadManager::uploadFile(StorageManager& storage, const char* filename) {
  if (!storage.openFileForRead(filename)) {
    Serial.printf("[WiFi] Failed to open file: %s\n", filename);
    return false;
  }

  uint32_t fileSize = storage.getOpenFileSize();

  uint8_t* buf = (uint8_t*)malloc(WIFI_UPLOAD_CHUNK_SIZE);
  if (!buf) {
    Serial.println("[WiFi] Failed to allocate upload buffer");
    storage.closeReadFile();
    return false;
  }

  String host;
  int port;
  bool useSSL;
  parseServerUrl(host, port, useSSL);

  Serial.printf("[WiFi] Connecting to %s:%d (SSL=%d)\n", host.c_str(), port, useSSL);

  bool success = false;

  if (useSSL) {
    WiFiClientSecure sslClient;
    sslClient.setInsecure();  // TODO: cert pinning for production
    if (sslClient.connect(host.c_str(), port)) {
      success = sendRequest(sslClient, storage, filename, host, fileSize, buf);
      sslClient.stop();
    } else {
      Serial.println("[WiFi] SSL connection failed");
    }
  } else {
    WiFiClient client;
    if (client.connect(host.c_str(), port)) {
      success = sendRequest(client, storage, filename, host, fileSize, buf);
      client.stop();
    } else {
      Serial.println("[WiFi] Connection failed");
    }
  }

  storage.closeReadFile();
  free(buf);
  return success;
}
