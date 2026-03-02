/*
 * WiFi Upload Manager - Direct file upload to server via WiFi
 *
 * Non-blocking state machine driven by tick() in loop().
 * Connects to WiFi, uploads .vtx files via HTTP POST, disconnects.
 * Credentials stored in NVS (Non-Volatile Storage).
 */

#ifndef WIFI_MANAGER_H
#define WIFI_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include "config.h"

// Forward declaration
class StorageManager;

enum WiFiSyncState : int {
  WIFI_IDLE,
  WIFI_CONNECTING,
  WIFI_UPLOADING,
  WIFI_NEXT_FILE,
  WIFI_DONE,
  WIFI_ERROR,
};

struct SyncProgress {
  uint8_t currentFile;
  uint8_t totalFiles;
  uint32_t bytesSent;
  uint32_t bytesTotal;
};

class WiFiUploadManager {
public:
  WiFiUploadManager();

  // Load credentials from NVS
  void init();

  // Check if WiFi + auth credentials are provisioned
  bool hasCredentials() const;

  // Begin upload sequence — sets state to WIFI_CONNECTING
  void startSync(StorageManager& storage);

  // Cancel current upload
  void cancelSync();

  // Non-blocking tick — call from loop() when state == STATE_UPLOADING
  // Returns true while sync is in progress
  bool tick(StorageManager& storage);

  // Current state for BLE status reporting
  WiFiSyncState getSyncState() const { return _state; }

  // Progress for BLE status
  SyncProgress getProgress() const { return _progress; }

  // Credential management (called from BLE command handlers)
  void saveWiFiCredentials(const char* ssid, const char* password);
  void saveUserCredentials(const char* userId, const char* apiKey, const char* serverUrl);

private:
  WiFiSyncState _state;
  SyncProgress _progress;
  unsigned long _stateEnteredAt;

  // Credentials (loaded from NVS)
  char _ssid[33];
  char _password[65];
  char _userId[64];
  char _apiKey[65];
  char _serverUrl[128];

  // File list for upload
  static const int MAX_UPLOAD_FILES = 32;
  char _fileNames[MAX_UPLOAD_FILES][32];
  int _fileCount;
  int _currentFileIndex;

  // Connect to WiFi (blocking within tick, with timeout)
  bool connectWiFi();

  // Upload a single file — returns true on success
  bool uploadFile(StorageManager& storage, const char* filename);

  // Disconnect WiFi
  void disconnectWiFi();

  // Load credentials from NVS
  void loadCredentials();
};

#endif // WIFI_MANAGER_H
