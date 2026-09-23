/*
 * Log Ring — Pure Offset Arithmetic and Record Framing
 *
 * The computational core of the on-device diagnostic log, factored out so it
 * can be compiled and tested on a host with no Arduino runtime and no SD card.
 * LogManager calls these functions; they hold no state beyond what the caller
 * passes in and touch no hardware.
 *
 * Anything in this header must compile against plain <stdint.h>/<string.h>.
 * Hardware calls (SD.write, SD.seek) stay at the call site.
 *
 * ===== Why this exists =====
 *
 * A 2.6 h ride on 2026-09-07 produced 0 clock-sync records where ~156 were
 * due (notes/VALIDATION_PLAN.md §C3). The device logs to serial only, so the
 * ride carried no evidence: it was impossible to tell whether the device asked
 * and got no answer, or never asked at all. Several hypotheses were generated
 * and none could be settled from the file. The system has excellent telemetry
 * about the world and none about itself; this closes that gap.
 *
 * ===== On-disk layout =====
 *
 *   [LOG_HEADER_SIZE byte header] [LOG_RING_BYTES byte ring region]
 *
 * The header is fixed-size and rewritten in place on each flush. The ring
 * region is a circular byte buffer of plain text lines.
 *
 *   offset  width  field
 *   0       4      magic "VLOG"
 *   4       2      version (uint16)
 *   6       2      reserved (zero)
 *   8       4      write_offset — bytes into the ring region (uint32)
 *   12      8      total_written — bytes ever written, monotonic (uint64)
 *   20      4      ring_bytes — region size this file was created with (uint32)
 *   24      8      reserved (zero)
 *
 * `total_written` is monotonic across reboots AND wraps: it is the position
 * space readers hold against. `write_offset` is always
 * `total_written % ring_bytes` for a file written by one firmware build, but
 * it is stored rather than derived so a ring_bytes change is detectable
 * instead of silently reinterpreting every stored position.
 *
 * ===== Wrap discipline =====
 *
 * A line that would straddle the end of the region is never split. The tail is
 * filled with newline padding and the line begins again at offset 0. One
 * partial line is lost per wrap, and the parser never sees a truncated record.
 * Newline is the pad byte precisely because it is also the terminator — a
 * decoder splitting on '\n' yields empty strings for padding, which it drops
 * without needing to know where the pad region was.
 *
 * ===== Vocabulary =====
 *
 * Two coordinate systems appear throughout, and mixing them up is the main way
 * to misread this file.
 *
 *   offset    A physical byte position INSIDE the ring region, always in
 *             [0, ringBytes). Wraps to 0 at the end. `writeOffset` is where the
 *             next byte physically lands. Type: uint32_t.
 *
 *   position  A logical byte count in `total_written` space — monotonic, never
 *             wraps, grows forever. Readers hold one of these. Type: uint64_t.
 *
 * The bridge between them is logOffsetForPos(): offset = position % ringBytes.
 * Positions are 64-bit because they must not wrap; offsets are 32-bit because
 * they cannot exceed the region size.
 *
 * Other recurring names:
 *
 *   ringBytes    Size of the ring region in bytes, excluding the header.
 *   lineLen      Length of a formatted line EXCLUDING its newline. A record on
 *                disk always occupies lineLen + 1 bytes.
 *   advance      Bytes a write consumes from capacity — what total_written
 *                grows by. Includes any padding, so it can exceed lineLen + 1.
 *   lapped       A reader fell more than one full ring behind, so bytes it
 *                never saw were overwritten.
 *
 * ===== Conventions =====
 *
 * Output parameters are pointers and are written only on success; a function
 * returning false leaves them untouched. Functions returning a struct always
 * fill every field. Nothing here allocates, blocks, or touches hardware.
 */

#ifndef LOG_RING_H
#define LOG_RING_H

#include <stdint.h>
#include <string.h>
#include <stdio.h>

#include "config.h"

// ===== Log header field offsets =====
#define LOG_OFF_MAGIC          0   // char[4]  "VLOG"
#define LOG_OFF_VERSION        4   // uint16
#define LOG_OFF_RESERVED_6     6   // uint16   (zero)
#define LOG_OFF_WRITE_OFFSET   8   // uint32
#define LOG_OFF_TOTAL_WRITTEN 12   // uint64
#define LOG_OFF_RING_BYTES    20   // uint32
// 24..31 reserved, zero

// ===== Severity =====
// Ordered so a numeric >= comparison is the level filter. Values are persisted
// in NVS and sent over BLE, so they are part of the wire contract: append
// only, never renumber.
enum LogLevel : uint8_t {
  LOG_DEBUG = 0,
  LOG_INFO  = 1,
  LOG_WARN  = 2,
  LOG_ERROR = 3,
};

// Single-character severity tag used in the serialized line. Chosen over a
// full word so the per-line overhead stays at one byte: at 10 MB of ring, the
// difference between "D" and "DEBUG" is measured in thousands of lines.
static inline char logLevelChar(uint8_t level) {
  switch (level) {
    case LOG_DEBUG: return 'D';
    case LOG_INFO:  return 'I';
    case LOG_WARN:  return 'W';
    case LOG_ERROR: return 'E';
    default:        return '?';
  }
}

// Parse a severity tag back.
//
//   c        the character from a serialized line
//   out      [out] LogLevel value, written only on success
//
//   returns  false for an unrecognised character, which the decoder reports
//            rather than silently bucketing as DEBUG.
static inline bool logLevelFromChar(char c, uint8_t* out) {
  switch (c) {
    case 'D': *out = LOG_DEBUG; break;
    case 'I': *out = LOG_INFO;  break;
    case 'W': *out = LOG_WARN;  break;
    case 'E': *out = LOG_ERROR; break;
    default: return false;
  }
  return true;
}

// The level filter: does a message at `level` clear the `minLevel` threshold?
// Kept as a function rather than an inline `>=` at each call site so the
// comparison direction is defined in exactly one place.
static inline bool logLevelPasses(uint8_t level, uint8_t minLevel) {
  return level >= minLevel;
}

// ===== Little-endian scalar stores =====
// Mirrors vtx_format.h. The ESP32-S3 is little-endian; these make the byte
// order explicit so the host tests and the Python decoder agree with the
// device without depending on the host's native order.

// Each logPut* writes `v` little-endian into `buf` and assumes the caller has
// provided at least that many bytes — 2, 4, or 8. No bounds check: these are
// called with fixed offsets into a LOG_HEADER_SIZE buffer.
//
//   buf  destination, must have room for the width
//   v    value to store

static inline void logPutU16(uint8_t* buf, uint16_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
}

static inline void logPutU32(uint8_t* buf, uint32_t v) {
  buf[0] = (uint8_t)(v & 0xFF);
  buf[1] = (uint8_t)((v >> 8) & 0xFF);
  buf[2] = (uint8_t)((v >> 16) & 0xFF);
  buf[3] = (uint8_t)((v >> 24) & 0xFF);
}

static inline void logPutU64(uint8_t* buf, uint64_t v) {
  for (int i = 0; i < 8; i++) {
    buf[i] = (uint8_t)((v >> (8 * i)) & 0xFF);
  }
}

// Each logGet* reads a little-endian value of its width back out of `buf`.
// Same no-bounds-check contract as the stores above.

static inline uint16_t logGetU16(const uint8_t* buf) {
  return (uint16_t)buf[0] | ((uint16_t)buf[1] << 8);
}

static inline uint32_t logGetU32(const uint8_t* buf) {
  return (uint32_t)buf[0] | ((uint32_t)buf[1] << 8)
       | ((uint32_t)buf[2] << 16) | ((uint32_t)buf[3] << 24);
}

static inline uint64_t logGetU64(const uint8_t* buf) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) v |= (uint64_t)buf[i] << (8 * i);
  return v;
}

// ===== Header serialization =====

// Serialize the log header. A fresh ring is write_offset=0, total_written=0.
//
//   header        [out] buffer of at least LOG_HEADER_SIZE bytes. Zeroed
//                 first, so reserved fields are always clean.
//   writeOffset   next physical write position in the ring, [0, ringBytes)
//   totalWritten  monotonic lifetime byte count
//   ringBytes     region size this file is being created with
static inline void logWriteHeader(uint8_t* header, uint32_t writeOffset,
                                  uint64_t totalWritten, uint32_t ringBytes) {
  memset(header, 0, LOG_HEADER_SIZE);
  memcpy(header + LOG_OFF_MAGIC, LOG_MAGIC, 4);
  logPutU16(header + LOG_OFF_VERSION, LOG_FORMAT_VERSION);
  logPutU32(header + LOG_OFF_WRITE_OFFSET, writeOffset);
  logPutU64(header + LOG_OFF_TOTAL_WRITTEN, totalWritten);
  logPutU32(header + LOG_OFF_RING_BYTES, ringBytes);
}

// Parse and validate a log header. Returns false — leaving the outputs
// untouched — if the magic, version, or geometry does not check out.
//
//   header          [in]  buffer of at least LOG_HEADER_SIZE bytes
//   writeOffset     [out] written only on success
//   totalWritten    [out] written only on success
//   expectRingBytes the region size THIS firmware build uses; the header must
//                   agree or the file is rejected
//
//   returns  true if every check passed and the outputs are populated
//
// Five ways to fail, in order checked: wrong magic, wrong version, geometry
// mismatch, offset outside the region, and the two stored fields disagreeing
// with each other.
//
// The geometry check is the one that matters in practice: a ring written with
// a different LOG_RING_BYTES has stored offsets that mean something else. It
// is rejected rather than reinterpreted, which turns a firmware constant
// change into a fresh log rather than a silently mis-parsed one.
static inline bool logReadHeader(const uint8_t* header, uint32_t* writeOffset,
                                 uint64_t* totalWritten, uint32_t expectRingBytes) {
  if (memcmp(header + LOG_OFF_MAGIC, LOG_MAGIC, 4) != 0) return false;
  if (logGetU16(header + LOG_OFF_VERSION) != LOG_FORMAT_VERSION) return false;
  if (logGetU32(header + LOG_OFF_RING_BYTES) != expectRingBytes) return false;

  const uint32_t off = logGetU32(header + LOG_OFF_WRITE_OFFSET);
  if (off >= expectRingBytes) return false;  // corrupt: offset outside region

  const uint64_t total = logGetU64(header + LOG_OFF_TOTAL_WRITTEN);
  // total_written and write_offset must agree, or one of them is corrupt and
  // every reader position derived from the pair is wrong.
  if ((uint32_t)(total % expectRingBytes) != off) return false;

  *writeOffset = off;
  *totalWritten = total;
  return true;
}

// ===== Record framing =====

// Format one log line into `out`, WITHOUT the trailing newline.
//
//   out       [out] destination buffer
//   outSize   capacity of `out`, including room for the NUL snprintf writes
//   millisNow raw millis() at the call site
//   level     LogLevel value; anything unrecognised renders as '?'
//   tag       subsystem string, e.g. "CLK"
//   msg       already-formatted message text
//
//   returns   length written, always < outSize and never negative. The caller
//             adds the newline — that is why the return excludes it.
//
// Layout: "<millis> <L> <tag> <message>"
//   millis  — raw millis(), the same time base as IMU sample timestamps, so a
//             log line can be placed against the sample stream directly.
//             Deliberately not wall clock: the clock may be unsynced (that is
//             one of the things worth logging), and millis() never lies about
//             being unavailable.
//   L       — one-character severity
//   tag     — subsystem, matching the existing serial convention minus the
//             brackets: CLK, BLE, SD, REC, IMU, PWR, WIFI.
//
// A message longer than the buffer is truncated, never split across lines: a
// truncated line is still parseable and still says which tag emitted it.
static inline int logFormatLine(char* out, int outSize, uint32_t millisNow,
                                uint8_t level, const char* tag, const char* msg) {
  int n = snprintf(out, (size_t)outSize, "%lu %c %s %s",
                   (unsigned long)millisNow, logLevelChar(level), tag, msg);
  // snprintf returns the length it WOULD have written. Clamp to what fits.
  if (n < 0) return 0;
  if (n >= outSize) n = outSize - 1;

  // A newline inside the message would frame a second, headerless record.
  // Replace rather than reject: dropping a line because it contains a newline
  // loses exactly the diagnostic the caller wanted.
  for (int i = 0; i < n; i++) {
    if (out[i] == '\n' || out[i] == '\r') out[i] = ' ';
  }
  return n;
}

// ===== Ring offset arithmetic =====

// Bytes from `writeOffset` to the physical end of the ring region.
//
//   writeOffset  current write position, [0, ringBytes)
//   ringBytes    region size
//
//   returns      how much room is left before the end. Never zero for a valid
//                offset, since writeOffset == ringBytes is out of range.
static inline uint32_t logBytesToEnd(uint32_t writeOffset, uint32_t ringBytes) {
  return ringBytes - writeOffset;
}

// Decide how a line of `lineLen` bytes (excluding its newline) is placed.
//
// The caller writes `padBytes` newlines at `writeOffset`, then the line plus
// its own newline at `lineStart`. When the line fits, padBytes is 0 and
// lineStart == writeOffset.
//
// A line exactly filling the remaining space does NOT wrap: lineLen+1 == space
// leaves the next write at offset 0 naturally, with no padding needed.
struct LogPlacement {
  uint32_t padBytes;    // newlines written at writeOffset before the line
  uint32_t lineStart;   // offset the line itself begins at
  uint32_t nextOffset;  // write_offset after this record lands
  uint32_t advance;     // total bytes consumed — what total_written grows by
};

//   writeOffset  current write position, [0, ringBytes)
//   ringBytes    region size
//   lineLen      formatted line length, EXCLUDING its newline
//
//   returns      a fully-populated LogPlacement; never fails
//
// Two shapes of result:
//
//   Fits     padBytes = 0, lineStart == writeOffset, advance == lineLen + 1.
//   Wraps    padBytes = space left at the tail, lineStart = 0, and advance
//            counts the padding too.
//
// So `advance` is the field to trust for capacity accounting, not lineLen + 1.
static inline LogPlacement logPlaceLine(uint32_t writeOffset, uint32_t ringBytes,
                                        uint32_t lineLen) {
  LogPlacement p;
  const uint32_t needed = lineLen + 1;  // line + its newline terminator
  const uint32_t space = logBytesToEnd(writeOffset, ringBytes);

  if (needed <= space) {
    p.padBytes = 0;
    p.lineStart = writeOffset;
    p.advance = needed;
    p.nextOffset = writeOffset + needed;
    if (p.nextOffset == ringBytes) p.nextOffset = 0;  // exact fit wraps to 0
  } else {
    // Pad the tail and restart at 0. The padding is consumed capacity, so it
    // counts toward total_written — otherwise a reader's position arithmetic
    // would drift from the writer's by the pad bytes on every wrap.
    p.padBytes = space;
    p.lineStart = 0;
    p.advance = space + needed;
    p.nextOffset = needed;
  }
  return p;
}

// ===== Reader position and lap detection =====

// What a reader should do when it asks for data from `readerPos`.
//
// Lap detection is the point of this function. A reader that falls more than
// one ring behind has had data overwritten that it never saw. It must skip to
// the oldest surviving byte and REPORT the gap — never silently resync. Same
// principle as dropped-sample handling in timestamp_reconstruction: flag the
// loss, do not paper over it.
struct LogReadPlan {
  uint64_t fromPos;      // position to read from, in total_written space
  uint32_t available;    // bytes readable from there up to the writer
  uint64_t gapBytes;     // bytes overwritten before the reader saw them
  bool lapped;           // true when gapBytes > 0
};

//   readerPos     where the reader last left off, in position space
//   totalWritten  the writer's current position
//   ringBytes     region size
//
//   returns       a fully-populated LogReadPlan; never fails
//
// Three outcomes:
//
//   Caught up or ahead   available = 0, fromPos = totalWritten. Includes the
//                        readerPos > totalWritten case, which means the log was
//                        reset under the reader.
//   Inside the ring      fromPos = readerPos, nothing lost.
//   Lapped               lapped = true, fromPos jumps forward to the oldest
//                        surviving byte, gapBytes says how much was missed.
//
// Note `available` is uint32_t while positions are uint64_t: the readable span
// can never exceed ringBytes, so the narrowing is safe by construction.
static inline LogReadPlan logPlanRead(uint64_t readerPos, uint64_t totalWritten,
                                      uint32_t ringBytes) {
  LogReadPlan r;
  r.gapBytes = 0;
  r.lapped = false;

  // A reader ahead of the writer means the log was reset (or the reader holds
  // a position from a different, longer-lived file). Treat it as fully caught
  // up rather than computing a negative span in unsigned arithmetic.
  if (readerPos >= totalWritten) {
    r.fromPos = totalWritten;
    r.available = 0;
    return r;
  }

  const uint64_t behind = totalWritten - readerPos;
  if (behind > ringBytes) {
    // Overwritten. The oldest surviving byte is one full ring back from the
    // write head.
    r.lapped = true;
    r.fromPos = totalWritten - ringBytes;
    r.gapBytes = behind - ringBytes;
    r.available = ringBytes;
  } else {
    r.fromPos = readerPos;
    r.available = (uint32_t)behind;
  }
  return r;
}

// Map a total_written position to its byte offset inside the ring region.
// This is the bridge between the two coordinate systems described at the top.
//
//   pos        position-space value, monotonic
//   ringBytes  region size
//
//   returns    the physical offset, always [0, ringBytes)
static inline uint32_t logOffsetForPos(uint64_t pos, uint32_t ringBytes) {
  return (uint32_t)(pos % ringBytes);
}

// ===== Mid-line recovery =====

// After a wrap or a lap skip, a read position lands mid-line. Scan forward to
// the first newline and report how many bytes to discard.
//
//   buf      [in] window of bytes read from the ring
//   len      length of that window
//
//   returns  bytes to skip — the fragment plus its terminating newline — or
//            `len` if no newline was found, meaning the whole window is one
//            unterminated fragment and the caller should read more.
//
// A window starting ON a newline returns 1: the fragment is zero-length and
// only the terminator is consumed.
//
// Padding at a wrap boundary is a run of newlines, so this naturally lands on
// the first byte of real content: each pad newline terminates a zero-length
// fragment that the decoder drops.
static inline uint32_t logSkipPartialLine(const uint8_t* buf, uint32_t len) {
  for (uint32_t i = 0; i < len; i++) {
    if (buf[i] == '\n') return i + 1;
  }
  return len;
}

// Trim a read window to end on the last complete line, returning the length to
// keep. The complement of logSkipPartialLine(): that drops a fragment at the
// START of a window, this drops one at the END.
//
//   buf      [in] window of bytes read from the ring
//   len      length of that window
//
//   returns  length to keep, INCLUDING the final newline. Equals `len` when the
//            window already ends on a newline, and 0 when the window holds no
//            complete line at all.
//
// Needed because a chunked read cuts wherever the chunk size falls, which is
// mid-line most of the time. Without this a reader receives
// "1180 W BLE client disconnected with a t" as if it were a whole record. The
// discarded tail is not lost — the reader's position only advances over what
// was returned, so the next read begins at the start of that line.
//
// Returns 0 when the window contains no newline at all, meaning no complete
// line is available yet; the caller should read further rather than emit the
// fragment.
static inline uint32_t logTrimToLastLine(const uint8_t* buf, uint32_t len) {
  for (uint32_t i = len; i > 0; i--) {
    if (buf[i - 1] == '\n') return i;
  }
  return 0;
}

#endif // LOG_RING_H
