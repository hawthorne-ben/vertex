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

  // File listing and transfer
  int listFiles(FileEntry* entries, int maxEntries);
  bool openFileForRead(const char* name);
  int readFileChunk(uint8_t* buffer, int maxBytes);  // Returns bytes read, 0 = EOF
  void closeReadFile();
  bool deleteFile(const char* name);

  // Status
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

  // Validate filename (no traversal, .vtx extension, safe chars)
  bool isValidFilename(const char* name);
  // Write the 64-byte VTX header + JSON metadata section
  void writeVTXHeader(int64_t startTimestampMs);
  // Patch header fields in-place (seek to offset, write, seek back)
  void patchHeader(int64_t endTimestampMs);
};

#endif // STORAGE_MANAGER_H
