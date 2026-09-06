/*
 * Storage Manager V2 - SD card VTX file logging and management
 *
 * Writes files in VTX binary format (packages/vtx-parser compatible):
 *   [64-byte header] [JSON metadata] [IMU records...]
 *
 * The header is written with placeholder values on file open, then
 * patched with final recordCount/endTimestamp on file close.
 */

#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include <Arduino.h>
#include <SD.h>
#include <SPI.h>
#include "config.h"
#include "sensor_manager.h"

// VTX clock sync record — matches vtx-parser v1.2 layout (24 bytes).
// Device timestamps are raw millis(), NOT offsets from recording start: a
// sync record characterizes the millis() time base itself.
struct __attribute__((packed)) ClockSyncRecord {
  uint32_t t1_device_ms;      // millis() when request was sent
  uint32_t t4_device_ms;      // millis() when response was received
  int64_t  t2_phone_unix_ms;  // phone Date.now() at receipt of request
  int64_t  t3_phone_unix_ms;  // phone Date.now() at send of response
};
static_assert(sizeof(ClockSyncRecord) == VTX_SYNC_RECORD_SIZE, "ClockSyncRecord must be 24 bytes");

// File entry for BLE listing
struct FileEntry {
  char name[32];
  uint32_t size;  // bytes
};

class StorageManager {
public:
  StorageManager();

  // Initialize SD card on SPI bus
  bool init();

  // Recording file management
  bool openNewFile(int64_t wallClockMs);  // Wall clock unix ms from synced clock
  bool writeSamples(const IMURecord* samples, int count);  // Returns false on SD write error
  void closeFile(int64_t wallClockMs);    // Patches header with final endTimestamp + recordCount
  bool isFileOpen() const;

  // Clock sync records (VTX v1.2). Buffered in RAM during recording and
  // flushed as a trailing section on close — the section offset is not known
  // until the IMU record count is final. Returns false if the buffer is full,
  // which is not an error worth stopping a recording over.
  bool addSyncRecord(const ClockSyncRecord& rec);
  uint16_t getSyncRecordCount() const { return _syncCount; }

  // File listing and transfer
  int listFiles(FileEntry* entries, int maxEntries);
  bool openFileForRead(const char* name);
  int readFileChunk(uint8_t* buffer, int maxBytes);  // Returns bytes read, 0 = EOF
  void closeReadFile();
  bool deleteFile(const char* name);

  // Status
  bool isReady() const { return _sdReady; }
  uint32_t getFreeSpaceMB() const;
  uint32_t getCurrentFileSize() const;
  uint32_t getOpenFileSize() const;  // Size of currently open read file
  const char* getCurrentFileName() const;

private:
  SPIClass _spi;
  File _writeFile;
  File _readFile;
  char _currentFileName[48];
  bool _sdReady;
  uint32_t _recordCount;

  // Sync records buffered until closeFile() (12KB of RAM)
  ClockSyncRecord _syncBuffer[MAX_SYNC_RECORDS];
  uint16_t _syncCount;

  // Validate filename (no traversal, .vtx extension, safe chars)
  bool isValidFilename(const char* name);
  // Write the 64-byte VTX header + JSON metadata section
  void writeVTXHeader(int64_t startTimestampMs);
  // Patch header fields in-place (seek to offset, write, seek back)
  void patchHeader(int64_t endTimestampMs);
  // Append the buffered sync records and patch their header offset/count
  void writeSyncSection();
};

#endif // STORAGE_MANAGER_H
