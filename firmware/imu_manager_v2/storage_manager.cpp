/*
 * Storage Manager V2 Implementation
 * SD card VTX binary logging compatible with packages/vtx-parser.
 */

#include "storage_manager.h"

StorageManager::StorageManager()
  : _spi(HSPI),
    _sdReady(false),
    _recordCount(0) {
  _currentFileName[0] = '\0';
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

  // Convert unix ms to PST (UTC-8) date components for readable filename
  time_t secs = (time_t)(wallClockMs / 1000) - (8 * 3600);  // UTC to PST
  struct tm t;
  gmtime_r(&secs, &t);
  // Format: /vtx/3_1_2026_12345.vtx (month_day_year_millisInDay)
  uint32_t msInDay = (uint32_t)(((secs % 86400) * 1000) + (wallClockMs % 1000));
  snprintf(_currentFileName, sizeof(_currentFileName),
           "%s/%d_%d_%d_%lu.vtx", LOG_DIR,
           t.tm_mon + 1, t.tm_mday, t.tm_year + 1900, (unsigned long)msInDay);

  _writeFile = SD.open(_currentFileName, FILE_WRITE);
  if (!_writeFile) {
    Serial.printf("[SD] Failed to open %s\n", _currentFileName);
    return false;
  }

  _recordCount = 0;
  writeVTXHeader(wallClockMs);

  Serial.printf("[SD] Recording to %s\n", _currentFileName);
  return true;
}

void StorageManager::writeVTXHeader(int64_t startTimestampMs) {
  // --- 64-byte fixed header ---
  // All multi-byte values are little-endian (ESP32 native)
  uint8_t header[VTX_HEADER_SIZE];
  memset(header, 0, VTX_HEADER_SIZE);

  int off = 0;

  // Magic "VTX\0" (4 bytes)
  header[off++] = 'V';
  header[off++] = 'T';
  header[off++] = 'X';
  header[off++] = '\0';

  // Version major (uint16) + minor (uint16)
  uint16_t vMajor = VTX_FORMAT_MAJOR;
  uint16_t vMinor = VTX_FORMAT_MINOR;
  memcpy(header + off, &vMajor, 2); off += 2;
  memcpy(header + off, &vMinor, 2); off += 2;

  // Metadata length (uint32) — placeholder, patched on close
  // We'll build metadata JSON now so we know the length
  char metaJson[256];
  int metaLen = snprintf(metaJson, sizeof(metaJson),
    "{\"device\":{\"name\":\"%s\",\"firmwareVersion\":\"%s\",\"hardwareRevision\":\"v2\"},"
    "\"session\":{\"position\":\"Seatpost\"}}",
    BLE_DEVICE_NAME, FIRMWARE_VERSION);

  uint32_t metadataLength = (uint32_t)metaLen;
  memcpy(header + off, &metadataLength, 4); off += 4;

  // Data offset (uint32) = header + metadata
  uint32_t dataOffset = VTX_HEADER_SIZE + metadataLength;
  memcpy(header + off, &dataOffset, 4); off += 4;

  // Record count (uint64) — placeholder 0, patched on close
  uint64_t recordCount = 0;
  memcpy(header + off, &recordCount, 8); off += 8;

  // Sample rate (float32)
  float sampleRate = (float)IMU_ODR_HZ;
  memcpy(header + off, &sampleRate, 4); off += 4;

  // Start timestamp (int64, unix ms)
  memcpy(header + off, &startTimestampMs, 8); off += 8;

  // End timestamp (int64) — placeholder, patched on close
  int64_t endTs = 0;
  memcpy(header + off, &endTs, 8); off += 8;

  // Record format (uint8)
  header[off++] = VTX_RECORD_FORMAT;

  // Compression (uint8)
  header[off++] = VTX_COMPRESSION_NONE;

  // GPS record count (uint64) — 0 (no GPS on device)
  // GPS data offset (uint32) — 0
  // (already zeroed by memset)

  // Write header
  _writeFile.write(header, VTX_HEADER_SIZE);

  // Write metadata JSON
  _writeFile.write((const uint8_t*)metaJson, metaLen);

  _writeFile.flush();
}

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
  if (_recordCount % (IMU_ODR_HZ * 10) == 0) {
    _writeFile.flush();
  }
  return true;
}

void StorageManager::closeFile(int64_t wallClockMs) {
  if (!_writeFile) return;

  _writeFile.flush();
  patchHeader(wallClockMs);
  _writeFile.close();

  Serial.printf("[SD] Closed %s — %lu records, %luKB\n",
                _currentFileName, (unsigned long)_recordCount,
                (unsigned long)(_recordCount * VTX_IMU_RECORD_SIZE) / 1024);
}

void StorageManager::patchHeader(int64_t endTimestampMs) {
  // Patch recordCount at offset 16 (uint64)
  _writeFile.seek(16);
  uint64_t rc = (uint64_t)_recordCount;
  _writeFile.write((const uint8_t*)&rc, 8);

  // Patch endTimestamp at offset 36 (int64)
  _writeFile.seek(36);
  _writeFile.write((const uint8_t*)&endTimestampMs, 8);

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
