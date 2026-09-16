/*
 * Log Manager — on-device diagnostic log to a fixed-size SD ring file
 *
 * Supplements serial output; it does not replace it. Every logged line still
 * goes to Serial exactly as before, so a bench session over USB is unchanged.
 *
 * The ring survives reboot: write_offset and total_written are persisted in
 * the file header, so "what happened on the last three rides" is answerable.
 *
 * Logging is strictly best-effort. A log write failure must never stop or
 * disturb a recording — every failure path here drops the line and continues,
 * and no caller checks a return value. See log_ring.h for the offset
 * arithmetic, wrap discipline, and lap detection, all of which are host-tested.
 */

#ifndef LOG_MANAGER_H
#define LOG_MANAGER_H

#include <Arduino.h>
#include <SD.h>
#include "config.h"
#include "log_ring.h"

class LogManager {
public:
  LogManager();

  // Open or create the ring file. Safe to call when the SD card is absent:
  // logging degrades to serial-only rather than failing init.
  bool init();

  // Append one record. Always mirrors to Serial; writes to the ring only when
  // the level passes the configured minimum. Never blocks, never fails
  // visibly.
  void log(uint8_t level, const char* tag, const char* fmt, ...)
      __attribute__((format(printf, 4, 5)));

  // Flush the RAM buffer to SD if anything is pending. Called from loop() on
  // the time-based trigger; the level and half-capacity triggers flush inline.
  void tick();

  // Force a flush now — used before a deliberate reboot or shutdown, where
  // the last lines written are the ones explaining why.
  void flush();

  // Reset the ring to empty. Discards the RAM buffer and rewinds the header to
  // offset 0 / total_written 0.
  //
  // The 10 MB region is deliberately NOT erased: writing it would take minutes
  // over SPI and stall the loop, and nothing can read past total_written
  // anyway, so stale bytes beyond the head are unreachable rather than merely
  // hidden. The one consequence is that every reader's stored position is now
  // meaningless — a reader holding 50,000 against a ring that restarts at 0
  // looks far ahead of the writer. logPlanRead() already clamps that case to
  // "caught up" rather than computing a negative span, so a stale reader sees
  // nothing until the ring passes it rather than reading garbage.
  void clear();

  // ===== Runtime level control (BLE, persisted in NVS) =====
  uint8_t getMinLevel() const { return _minLevel; }
  void setMinLevel(uint8_t level);  // Persists to NVS

  // ===== Reader support (BLE) =====
  // Readers hold a position in total_written space, not a raw offset, and read
  // from the FILE — there is no second RAM buffer for BLE. One buffer, one
  // retention policy; live tail and backfill are the same operation.
  uint64_t getTotalWritten() const { return _totalWritten; }

  // Read up to maxBytes for a reader at `readerPos`. Fills `out`, advances
  // `readerPos` past what was returned, and sets `gapBytes` to the number of
  // bytes overwritten before this reader saw them (0 in the normal case).
  //
  // When bytes were lost, the read position lands mid-line; this scans forward
  // to the next newline and discards the fragment before returning, so a
  // caller never sees a truncated record. Returns bytes written to `out`.
  int readFrom(uint64_t& readerPos, uint8_t* out, int maxBytes, uint64_t& gapBytes);

  bool isReady() const { return _ready; }

private:
  File _file;
  bool _ready;

  uint32_t _writeOffset;    // bytes into the ring region
  uint64_t _totalWritten;   // bytes ever written, monotonic across reboots

  uint8_t _minLevel;

  // RAM staging buffer. Flushed on WARN+, half capacity, or 30 s.
  char _buffer[LOG_BUFFER_BYTES];
  int _bufferLen;
  unsigned long _lastFlushMs;

  // Statistics, themselves logged at each flush — a log that silently drops
  // lines is worse than no log, so the drop count is part of the record.
  uint32_t _droppedLines;
  uint32_t _writeFailures;

  // millis() of the last reader pull, or 0 if none this session. Drives the
  // faster flush cadence while somebody is actually watching.
  unsigned long _lastReadMs;

  // Append a formatted line (no newline) to the staging buffer.
  void appendToBuffer(const char* line, int len);
  // Write the ring header in place. Called on every flush.
  void writeHeader();
  // Copy `len` bytes into the ring at the current write offset, wrapping.
  bool writeToRing(const char* data, int len);
};

// Global instance. Declared here and defined in log_manager.cpp so every
// manager can log without threading a reference through each constructor —
// the same pattern g_ble already uses for BLE callbacks.
extern LogManager logger;

// Logging macros. The level check happens before argument evaluation, so a
// filtered-out DEBUG line costs a comparison rather than a vsnprintf.
//
// Serial output is NOT gated by _minLevel — it is preserved exactly as it was,
// so raising the SD threshold never makes a bench session quieter.
#define LOG_E(tag, ...) logger.log(LOG_ERROR, tag, __VA_ARGS__)
#define LOG_W(tag, ...) logger.log(LOG_WARN,  tag, __VA_ARGS__)
#define LOG_I(tag, ...) logger.log(LOG_INFO,  tag, __VA_ARGS__)
#define LOG_D(tag, ...) logger.log(LOG_DEBUG, tag, __VA_ARGS__)

#endif // LOG_MANAGER_H
