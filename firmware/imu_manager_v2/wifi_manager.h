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
  WIFI_CHECK_EXISTING,  // Ask server which files already exist
  WIFI_UPLOADING,       // Open file + connect + send headers
  WIFI_STREAMING,       // Stream file data one chunk per tick()
  WIFI_WAIT_RESPONSE,   // Wait for HTTP response after streaming
  WIFI_NEXT_FILE,
  WIFI_DONE,
  WIFI_ERROR,
};

// Sync result codes (sent in status notification byte [18])
#define SYNC_RESULT_IN_PROGRESS 0
#define SYNC_RESULT_SUCCESS     1
#define SYNC_RESULT_ERROR       2

struct SyncProgress {
  uint8_t currentFile;
  uint8_t totalFiles;
  uint32_t bytesSent;
  uint32_t bytesTotal;
  uint8_t result;  // SYNC_RESULT_*
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

  // Check if a file has been synced to server (exists or was uploaded this session)
  bool isFileSynced(const char* filename) const;

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
  uint32_t _fileSizes[MAX_UPLOAD_FILES];
  int _fileCount;
  int _currentFileIndex;

  // Begin uploading current file — opens connection, sends HTTP headers
  bool beginFileUpload(StorageManager& storage, const char* filename);

  // Stream one chunk — returns true while data remains
  bool streamNextChunk(StorageManager& storage);

  // Read HTTP response after streaming completes — returns true on 200
  bool readResponse();

  // Clean up current file upload state
  void endFileUpload(StorageManager& storage);

  // Parse _serverUrl into host, port, useSSL
  void parseServerUrl(String& host, int& port, bool& useSSL);

  // Disconnect WiFi
  void disconnectWiFi();

  // Load credentials from NVS
  void loadCredentials();

  // Check server for already-uploaded files, mark them to skip
  bool checkExistingFiles();

  // Streaming state for non-blocking upload
  Client* _activeClient;         // Current TCP connection (owned, heap-allocated)
  bool _clientIsSSL;             // Whether _activeClient is WiFiClientSecure
  uint8_t* _uploadBuf;           // Chunk buffer (heap-allocated)
  uint32_t _fileRemaining;       // Bytes left to stream
  String _partFooter;            // Multipart footer to send after file data
  bool _fileSkip[MAX_UPLOAD_FILES];  // Files that already exist on server
};

#endif // WIFI_MANAGER_H
