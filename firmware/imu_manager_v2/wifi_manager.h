/*
 * WiFi Upload Manager - Direct file upload to Supabase Storage via presigned URLs
 *
 * Non-blocking state machine driven by tick() in loop().
 * Flow per file: presign (get URL) → PUT to Supabase → complete (create DB record)
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
  WIFI_PRESIGN,         // Get presigned upload URL from server
  WIFI_STREAMING,       // PUT file data directly to Supabase Storage
  WIFI_WAIT_RESPONSE,   // Wait for PUT response
  WIFI_COMPLETE,        // Notify server to create DB record
  WIFI_NEXT_FILE,
  WIFI_DONE,
  WIFI_ERROR,
};

// Sync result codes (sent in status notification byte)
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

  void init();
  bool hasCredentials() const;
  void startSync(StorageManager& storage);
  void cancelSync();
  bool tick(StorageManager& storage);

  WiFiSyncState getSyncState() const { return _state; }
  SyncProgress getProgress() const { return _progress; }
  bool isFileSynced(const char* filename) const;

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

  // Presigned upload state
  String _uploadUrl;      // Full presigned URL from Supabase
  String _storagePath;    // Storage path for complete call

  // Streaming state
  Client* _activeClient;
  bool _clientIsSSL;
  uint8_t* _uploadBuf;
  uint32_t _fileRemaining;
  bool _fileSkip[MAX_UPLOAD_FILES];
  bool _responseSuccess;

  // Get presigned URL from server
  bool requestPresignedUrl(const char* filename, uint32_t fileSize);

  // Open connection to Supabase and send PUT headers
  bool beginDirectUpload(StorageManager& storage, const char* filename);

  // Stream one chunk
  bool streamNextChunk(StorageManager& storage);

  // Read HTTP response
  bool readResponse();

  // Notify server that upload is complete
  bool notifyComplete(const char* filename, uint32_t fileSize);

  // Clean up upload state
  void endFileUpload(StorageManager& storage);

  // Parse URL into host, port, path, useSSL
  static void parseUrl(const String& url, String& host, int& port, String& path, bool& useSSL);

  // Connect a client to host:port
  Client* connectClient(const String& host, int port, bool useSSL);
  void deleteClient();

  void disconnectWiFi();
  void loadCredentials();
  bool checkExistingFiles();

  // Send a JSON POST to our API server, return response body
  String apiPost(const char* endpoint, const String& jsonBody);
};

#endif // WIFI_MANAGER_H
