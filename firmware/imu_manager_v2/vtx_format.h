/*
 * VTX Format — Pure Serialization and Conversion Logic
 *
 * The computational core of the firmware's write path, factored out so it can
 * be compiled and tested on a host with no Arduino runtime, no I2C, and no SD
 * card. The managers call these functions; they hold no state and touch no
 * hardware.
 *
 * Anything in this header must compile against plain <stdint.h>/<string.h>.
 * Hardware calls (SD.write, Wire.read, digitalRead) stay at the call site.
 *
 * See firmware/test/ for the host test suite and README.md for the format spec.
 */

#ifndef VTX_FORMAT_H
#define VTX_FORMAT_H

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <time.h>

#include "config.h"

// ===== VTX header field offsets (see README.md format table) =====
#define VTX_OFF_MAGIC             0   // char[4]  "VTX\0"
#define VTX_OFF_VERSION_MAJOR     4   // uint16
#define VTX_OFF_VERSION_MINOR     6   // uint16
#define VTX_OFF_METADATA_LENGTH   8   // uint32
#define VTX_OFF_DATA_OFFSET      12   // uint32
#define VTX_OFF_RECORD_COUNT     16   // uint64
#define VTX_OFF_SAMPLE_RATE      24   // float32
#define VTX_OFF_START_TIMESTAMP  28   // int64
#define VTX_OFF_END_TIMESTAMP    36   // int64
#define VTX_OFF_RECORD_FORMAT    44   // uint8
#define VTX_OFF_COMPRESSION      45   // uint8
#define VTX_OFF_GPS_RECORD_COUNT 46   // uint64  (v1.1+, always 0 — no GPS)
#define VTX_OFF_GPS_DATA_OFFSET  54   // uint32  (v1.1+, always 0)
#define VTX_OFF_SYNC_DATA_OFFSET 58   // uint32  (v1.2+)
#define VTX_OFF_SYNC_RECORD_COUNT 62  // uint16  (v1.2+)

// ===== Little-endian scalar stores =====
// The ESP32-S3 is little-endian, so the firmware historically used memcpy of
// native values. These helpers make the byte order explicit and let the tests
// run on any host. Semantics are identical on a little-endian target.

static inline void vtxPutU16(uint8_t* buf, uint16_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
}

static inline void vtxPutU32(uint8_t* buf, uint32_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
  buf[2] = (uint8_t)((v >> 16) & 0xFF);
  buf[3] = (uint8_t)((v >> 24) & 0xFF);
}

static inline void vtxPutU64(uint8_t* buf, uint64_t v) {
  for (int i = 0; i < 8; i++) {
    buf[i] = (uint8_t)((v >> (8 * i)) & 0xFF);
  }
}

static inline void vtxPutI64(uint8_t* buf, int64_t v) {
  vtxPutU64(buf, (uint64_t)v);
}

static inline void vtxPutF32(uint8_t* buf, float v) {
  uint32_t bits;
  memcpy(&bits, &v, 4);
  vtxPutU32(buf, bits);
}

// ===== Metadata =====

// Build the JSON metadata section. Returns the length written (excluding the
// terminating NUL, which is not part of the file).
static inline int vtxBuildMetadata(char* out, int outSize) {
  return snprintf(out, (size_t)outSize,
    "{\"device\":{\"name\":\"%s\",\"firmwareVersion\":\"%s\",\"hardwareRevision\":\"v2\"},"
    "\"session\":{\"position\":\"Seatpost\"}}",
    BLE_DEVICE_NAME, FIRMWARE_VERSION);
}

// ===== Header serialization =====

// Serialize the 64-byte VTX header into `header`.
//
// record_count and end_timestamp are written as zero placeholders and patched
// on close by vtxPatchRecordCount/vtxPatchEndTimestamp. The GPS and sync
// fields are left zero here; writeSyncSection() patches the sync pair if any
// sync records were collected. Zeros are what make a recording with no sync
// records read back as "no sync stream" rather than as a corrupt offset.
static inline void vtxWriteHeader(uint8_t* header, uint32_t metadataLength,
                                  int64_t startTimestampMs) {
  memset(header, 0, VTX_HEADER_SIZE);

  header[VTX_OFF_MAGIC + 0] = 'V';
  header[VTX_OFF_MAGIC + 1] = 'T';
  header[VTX_OFF_MAGIC + 2] = 'X';
  header[VTX_OFF_MAGIC + 3] = '\0';

  vtxPutU16(header + VTX_OFF_VERSION_MAJOR, VTX_FORMAT_MAJOR);
  vtxPutU16(header + VTX_OFF_VERSION_MINOR, VTX_FORMAT_MINOR);
  vtxPutU32(header + VTX_OFF_METADATA_LENGTH, metadataLength);
  vtxPutU32(header + VTX_OFF_DATA_OFFSET, VTX_HEADER_SIZE + metadataLength);
  vtxPutU64(header + VTX_OFF_RECORD_COUNT, 0);  // patched on close
  vtxPutF32(header + VTX_OFF_SAMPLE_RATE, (float)IMU_ODR_HZ);
  vtxPutI64(header + VTX_OFF_START_TIMESTAMP, startTimestampMs);
  vtxPutI64(header + VTX_OFF_END_TIMESTAMP, 0);  // patched on close

  header[VTX_OFF_RECORD_FORMAT] = VTX_RECORD_FORMAT;
  header[VTX_OFF_COMPRESSION] = VTX_COMPRESSION_NONE;

  // 46..63 stay zero: no GPS on this hardware; sync pair patched on close.
}

// The two patch payloads written by StorageManager::patchHeader(). They are
// separate seeks in the firmware (offset 16 and offset 36 are not adjacent),
// so they serialize independently here too.
static inline void vtxPatchRecordCount(uint8_t* out8, uint64_t recordCount) {
  vtxPutU64(out8, recordCount);
}

static inline void vtxPatchEndTimestamp(uint8_t* out8, int64_t endTimestampMs) {
  vtxPutI64(out8, endTimestampMs);
}

// ===== Filename generation =====

// Build the recording filename from a wall-clock unix ms timestamp.
// Scheme: <LOG_DIR>/<month>_<day>_<year>_<msInDay>.vtx, in PST (UTC-8).
static inline void vtxBuildFilename(char* out, int outSize, int64_t wallClockMs) {
  time_t secs = (time_t)(wallClockMs / 1000) - (8 * 3600);  // UTC to PST
  struct tm t;
  gmtime_r(&secs, &t);
  uint32_t msInDay = (uint32_t)(((secs % 86400) * 1000) + (wallClockMs % 1000));
  snprintf(out, (size_t)outSize, "%s/%d_%d_%d_%lu.vtx", LOG_DIR,
           t.tm_mon + 1, t.tm_mday, t.tm_year + 1900, (unsigned long)msInDay);
}

// ===== Axis remap and scale conversion =====

// Convert one raw LSM6DS3 FIFO sample to physical units in the body frame.
//
// Chip -> body axis mapping (a cyclic permutation, det = +1, right-handed):
//   body X (forward/roll)  = chip Z
//   body Y (lateral/pitch) = chip X
//   body Z (vertical/yaw)  = chip Y (gravity axis)
//
// Units: accel m/s^2, gyro deg/s. GYRO_SCALE is the LSM6DS3 datasheet's
// deg/s-per-LSB figure for +/-1000 dps; no radian conversion is applied
// anywhere in the chain. Verified by firmware/test (gyro_units_are_...).
static inline void vtxConvertSample(int16_t gx, int16_t gy, int16_t gz,
                                    int16_t ax, int16_t ay, int16_t az,
                                    float* accelOut, float* gyroOut) {
  accelOut[0] = (float)az * ACCEL_SCALE;
  accelOut[1] = (float)ax * ACCEL_SCALE;
  accelOut[2] = (float)ay * ACCEL_SCALE;
  gyroOut[0] = (float)gz * GYRO_SCALE;
  gyroOut[1] = (float)gx * GYRO_SCALE;
  gyroOut[2] = (float)gy * GYRO_SCALE;
}

// ===== Button state machine =====

// The debounce/long-press logic from checkButtonPress(), with the pin read and
// the clock passed in so it can be driven deterministically in tests.
// Returns: 0 = no press, 1 = short press, 2 = long press.
struct ButtonState {
  unsigned long downTime;
  bool wasPressed;
  bool longPressHandled;
};

static inline void vtxButtonInit(ButtonState* s) {
  s->downTime = 0;
  s->wasPressed = false;
  s->longPressHandled = false;
}

static inline int vtxButtonUpdate(ButtonState* s, bool pressed, unsigned long nowMs) {
  if (pressed && !s->wasPressed) {
    s->downTime = nowMs;
    s->wasPressed = true;
    s->longPressHandled = false;
  }

  // Fire long press immediately while still held
  if (pressed && s->wasPressed && !s->longPressHandled) {
    if (nowMs - s->downTime >= BUTTON_LONG_PRESS_MS) {
      s->longPressHandled = true;
      return 2;
    }
  }

  if (!pressed && s->wasPressed) {
    s->wasPressed = false;
    if (s->longPressHandled) return 0;  // Already handled as long press
    unsigned long held = nowMs - s->downTime;
    if (held >= BUTTON_DEBOUNCE_MS) {
      return 1;  // Short press — toggle recording
    }
  }

  return 0;
}

#endif // VTX_FORMAT_H
