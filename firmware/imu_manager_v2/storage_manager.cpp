/*
 * Storage Manager V2 Implementation
 * SD card VTX binary logging compatible with packages/vtx-parser.
 */

#include "storage_manager.h"

StorageManager::StorageManager()
  : _spi(HSPI),
    _sdReady(false),
    _recordCount(0),
    _syncCount(0) {
  _currentFileName[0] = '\0';
  memset(_syncBuffer, 0, sizeof(_syncBuffer));
}

bool StorageManager::init() {
  Serial.println("[SD] Initializing...");

  _spi.begin(SD_SCK_PIN, SD_MISO_PIN, SD_MOSI_PIN, SD_CS_PIN);

  if (!SD.begin(SD_CS_PIN, _spi, SD_SPI_SPEED)) {
    Serial.println("[SD] Card mount failed");
    return false;
  }

  // Create log directory if needed
  if (!SD.exists(LOG_DIR)) {
    SD.mkdir(LOG_DIR);
  }

  _sdReady = true;
  Serial.printf("[SD] Ready — %lluMB total, %luMB free\n",
                SD.totalBytes() / (1024 * 1024),
                (unsigned long)getFreeSpaceMB());
  return true;
}

// ----------------------------------------------------------------
// VTX file writing
// ----------------------------------------------------------------

bool StorageManager::openNewFile(int64_t wallClockMs) {
  if (!_sdReady) return false;

  // Format: /vtx/3_1_2026_12345.vtx (month_day_year_millisInDay), PST
  vtxBuildFilename(_currentFileName, sizeof(_currentFileName), wallClockMs);

  _writeFile = SD.open(_currentFileName, FILE_WRITE);
  if (!_writeFile) {
    Serial.printf("[SD] Failed to open %s\n", _currentFileName);
    return false;
  }

  _recordCount = 0;
  _syncCount = 0;  // Sync records are per-recording
  writeVTXHeader(wallClockMs);

  Serial.printf("[SD] Recording to %s\n", _currentFileName);
  return true;
}

void StorageManager::writeVTXHeader(int64_t startTimestampMs) {
  // Header layout and byte order live in vtx_format.h so the host test suite
  // exercises the same code the device runs.
  char metaJson[256];
  int metaLen = vtxBuildMetadata(metaJson, sizeof(metaJson));

  uint8_t header[VTX_HEADER_SIZE];
  vtxWriteHeader(header, (uint32_t)metaLen, startTimestampMs);

  _writeFile.write(header, VTX_HEADER_SIZE);
  _writeFile.write((const uint8_t*)metaJson, metaLen);
  _writeFile.flush();
}

// Defined in main sketch
extern int64_t wallClockMs();

bool StorageManager::writeSamples(const IMURecord* samples, int count) {
  if (!_writeFile) return false;

  size_t bytes = count * sizeof(IMURecord);
  size_t written = _writeFile.write((const uint8_t*)samples, bytes);

  if (written != bytes) {
    Serial.printf("[SD] Write error: %d/%d bytes\n", written, bytes);
    return false;
  }

  _recordCount += count;

  // Flush periodically (~every 10 seconds at 104Hz)
  // Also patch header so file is valid if power is lost
  if (_recordCount % (IMU_ODR_HZ * 10) == 0) {
    size_t pos = _writeFile.position();
    patchHeader(wallClockMs());
    _writeFile.seek(pos);
    _writeFile.flush();
  }
  return true;
}

bool StorageManager::addSyncRecord(const ClockSyncRecord& rec) {
  if (_syncCount >= MAX_SYNC_RECORDS) {
    return false;  // Buffer full — recording continues without further samples
  }
  _syncBuffer[_syncCount++] = rec;
  return true;
}

// Append buffered sync records as a trailing section and patch the header.
// Called from closeFile() only: the section offset depends on the final IMU
// record count, which is not known until then. Consequence: a recording that
// loses power mid-ride keeps its IMU data but loses its sync records. This is
// the accepted cost of a trailing section (see the format spec).
void StorageManager::writeSyncSection() {
  if (!_writeFile || _syncCount == 0) return;

  // Seek to true end of file — patchHeader() leaves the cursor in the header
  _writeFile.seek(_writeFile.size());
  uint32_t syncOffset = (uint32_t)_writeFile.position();

  size_t bytes = (size_t)_syncCount * sizeof(ClockSyncRecord);
  size_t written = _writeFile.write((const uint8_t*)_syncBuffer, bytes);
  if (written != bytes) {
    Serial.printf("[SD] Sync section write failed: %u/%u bytes\n",
                  (unsigned)written, (unsigned)bytes);
    return;  // Header offset/count stay 0 — file reads as having no sync stream
  }
  _writeFile.flush();

  // Patch sync data offset (uint32 @ 58) and record count (uint16 @ 62)
  _writeFile.seek(VTX_OFF_SYNC_DATA_OFFSET);
  _writeFile.write((const uint8_t*)&syncOffset, 4);
  _writeFile.seek(VTX_OFF_SYNC_RECORD_COUNT);
  _writeFile.write((const uint8_t*)&_syncCount, 2);
  _writeFile.flush();

  Serial.printf("[SD] Wrote %u sync records at offset %lu\n",
                (unsigned)_syncCount, (unsigned long)syncOffset);
}

void StorageManager::closeFile(int64_t wallClockMs) {
  if (!_writeFile) return;

  _writeFile.flush();
  patchHeader(wallClockMs);
  writeSyncSection();
  _writeFile.close();

  Serial.printf("[SD] Closed %s — %lu records, %u sync, %luKB\n",
                _currentFileName, (unsigned long)_recordCount,
                (unsigned)_syncCount,
                (unsigned long)(_recordCount * VTX_IMU_RECORD_SIZE) / 1024);
}

void StorageManager::patchHeader(int64_t endTimestampMs) {
  uint8_t buf[8];

  // Patch recordCount at offset 16 (uint64)
  vtxPatchRecordCount(buf, (uint64_t)_recordCount);
  _writeFile.seek(VTX_OFF_RECORD_COUNT);
  _writeFile.write(buf, 8);

  // Patch endTimestamp at offset 36 (int64)
  vtxPatchEndTimestamp(buf, endTimestampMs);
  _writeFile.seek(VTX_OFF_END_TIMESTAMP);
  _writeFile.write(buf, 8);

  _writeFile.flush();
}

bool StorageManager::isFileOpen() const {
  return (bool)_writeFile;
}

// ----------------------------------------------------------------
// File listing and transfer (for BLE sync)
// ----------------------------------------------------------------

int StorageManager::listFiles(FileEntry* entries, int maxEntries) {
  if (!_sdReady) return 0;

  File dir = SD.open(LOG_DIR);
  if (!dir || !dir.isDirectory()) return 0;

  int count = 0;
  File file = dir.openNextFile();
  while (file) {
    if (!file.isDirectory()) {
      if (entries && count < maxEntries) {
        strncpy(entries[count].name, file.name(), sizeof(entries[count].name) - 1);
        entries[count].size = file.size();
      }
      count++;
    }
    file = dir.openNextFile();
  }
  dir.close();
  return count;
}

bool StorageManager::openFileForRead(const char* name) {
  if (!_sdReady) return false;
  if (!isValidFilename(name)) return false;

  char path[64];
  snprintf(path, sizeof(path), "%s/%s", LOG_DIR, name);

  _readFile = SD.open(path, FILE_READ);
  return (bool)_readFile;
}

int StorageManager::readFileChunk(uint8_t* buffer, int maxBytes) {
  if (!_readFile) return 0;
  return _readFile.read(buffer, maxBytes);
}

void StorageManager::closeReadFile() {
  if (_readFile) {
    _readFile.close();
  }
}

bool StorageManager::isValidFilename(const char* name) {
  if (!name || name[0] == '\0') return false;
  // Reject path traversal and absolute paths
  if (strstr(name, "..") != nullptr) return false;
  if (name[0] == '/') return false;
  // Must end in .vtx
  int len = strlen(name);
  if (len < 5 || strcmp(name + len - 4, ".vtx") != 0) return false;
  // Only allow alphanumeric, underscore, dot
  for (int i = 0; i < len; i++) {
    char c = name[i];
    if (!isalnum(c) && c != '_' && c != '.') return false;
  }
  return true;
}

bool StorageManager::deleteFile(const char* name) {
  if (!_sdReady) return false;
  if (!isValidFilename(name)) {
    Serial.printf("[SD] Invalid filename rejected: %s\n", name);
    return false;
  }

  char path[64];
  snprintf(path, sizeof(path), "%s/%s", LOG_DIR, name);
  return SD.remove(path);
}

uint32_t StorageManager::getFreeSpaceMB() const {
  if (!_sdReady) return 0;
  return (SD.totalBytes() - SD.usedBytes()) / (1024 * 1024);
}

uint32_t StorageManager::getCurrentFileSize() const {
  return _recordCount * VTX_IMU_RECORD_SIZE;
}

uint32_t StorageManager::getOpenFileSize() const {
  if (!_readFile) return 0;
  return _readFile.size();
}

const char* StorageManager::getCurrentFileName() const {
  return _currentFileName;
}
