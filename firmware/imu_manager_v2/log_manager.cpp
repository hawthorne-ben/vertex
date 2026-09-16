/*
 * Log Manager Implementation
 * Fixed-size SD ring file for on-device diagnostics.
 */

#include "log_manager.h"
#include <Preferences.h>
#include <stdarg.h>

LogManager logger;

LogManager::LogManager()
  : _ready(false),
    _writeOffset(0),
    _totalWritten(0),
    _minLevel(LOG_DEFAULT_MIN_LEVEL),
    _bufferLen(0),
    _lastFlushMs(0),
    _droppedLines(0),
    _writeFailures(0),
    _lastReadMs(0) {
  _buffer[0] = '\0';
}

bool LogManager::init() {
  // Level first: it is persisted independently of the file, so a card that
  // fails to mount still honours a level set over BLE on the previous boot.
  Preferences prefs;
  prefs.begin("log", true);  // read-only
  _minLevel = (uint8_t)prefs.getUChar("minLevel", LOG_DEFAULT_MIN_LEVEL);
  prefs.end();
  // Also clamp what NVS hands back: a WARN persisted by an earlier build would
  // otherwise survive the upgrade and keep hiding INFO events.
  if (_minLevel > LOG_MAX_MIN_LEVEL) _minLevel = LOG_MAX_MIN_LEVEL;

  _lastFlushMs = millis();

  bool existed = SD.exists(LOG_FILE_PATH);
  _file = SD.open(LOG_FILE_PATH, existed ? "r+" : "w+");
  if (!_file) {
    Serial.println("[LOG] Ring open failed — logging to serial only");
    return false;
  }

  bool resumed = false;
  if (existed && _file.size() >= LOG_HEADER_SIZE) {
    uint8_t header[LOG_HEADER_SIZE];
    _file.seek(0);
    if (_file.read(header, LOG_HEADER_SIZE) == LOG_HEADER_SIZE) {
      // A header that does not validate — wrong magic, version, or geometry —
      // means the stored offsets describe a different layout. Start fresh
      // rather than reinterpreting them; a mis-parsed ring is worse than an
      // empty one because it looks like data.
      resumed = logReadHeader(header, &_writeOffset, &_totalWritten, LOG_RING_BYTES);
    }
  }

  if (!resumed) {
    _writeOffset = 0;
    _totalWritten = 0;
    // Preallocating the full region would take minutes over SPI at 10 MB. The
    // file instead grows to its final size on the first wrap; until then a
    // read past the high-water mark simply returns nothing, and the header's
    // total_written already bounds every reader to what was actually written.
    writeHeader();
  }

  _ready = true;
  Serial.printf("[LOG] Ring %s — offset %lu, %llu bytes written, min level %c\n",
                resumed ? "resumed" : "initialized",
                (unsigned long)_writeOffset,
                (unsigned long long)_totalWritten,
                logLevelChar(_minLevel));

  // Boot is the single most useful line in the file: it separates sessions and
  // proves the device restarted rather than the log merely going quiet. INFO —
  // a successful boot is not an error. At a raised level the session boundary
  // is lost, which is the accepted cost of asking the device to record less.
  log(LOG_INFO, "SYS", "boot fw=%s ring=%s", FIRMWARE_VERSION,
      resumed ? "resumed" : "fresh");
  return true;
}

void LogManager::clear() {
  if (!_ready) return;

  // Drop anything staged in RAM first, or the next flush would write
  // pre-clear lines into the freshly rewound ring.
  _bufferLen = 0;
  _writeOffset = 0;
  _totalWritten = 0;
  _droppedLines = 0;
  _writeFailures = 0;
  _lastFlushMs = millis();
  writeHeader();

  // INFO: clearing is a deliberate user action, not a failure. The marker
  // still distinguishes a cleared ring from one that was silently failing to
  // write, which is its real job.
  log(LOG_INFO, "LOG", "ring cleared");
}

void LogManager::setMinLevel(uint8_t level) {
  if (level > LOG_ERROR) return;
  // Cap how restrictive the level can get, rather than trusting the caller.
  // A _minLevel above INFO would hide the events the log exists to capture
  // (recording start/stop, connect/disconnect, clock sync) to save ~18 KB per
  // ride against a 10 MB ring — a trade with no upside. Only DEBUG is
  // optional, so an out-of-range request is corrected rather than rejected.
  if (level > LOG_MAX_MIN_LEVEL) level = LOG_MAX_MIN_LEVEL;
  _minLevel = level;

  Preferences prefs;
  prefs.begin("log", false);
  prefs.putUChar("minLevel", level);
  prefs.end();

  // Logged AFTER _minLevel is updated, so it is filtered by the new level: at
  // ERROR the change leaves no trace. That is the honest behaviour — a level
  // that silently exempts its own writes is not the level the user set. The
  // previous ERROR marking conflated "must not be lost" with "a failure".
  log(LOG_INFO, "LOG", "min level set to %c", logLevelChar(level));
}

void LogManager::log(uint8_t level, const char* tag, const char* fmt, ...) {
  char msg[LOG_LINE_MAX];
  va_list args;
  va_start(args, fmt);
  vsnprintf(msg, sizeof(msg), fmt, args);
  va_end(args);

  // Serial output is preserved unconditionally and in the original format:
  // this supplements serial, it does not replace it. Bracketed tag, as before.
  Serial.printf("[%s] %s\n", tag, msg);

  if (!_ready) return;
  if (!logLevelPasses(level, _minLevel)) return;

  char line[LOG_LINE_MAX];
  int len = logFormatLine(line, sizeof(line), (uint32_t)millis(), level, tag, msg);
  if (len <= 0) return;

  appendToBuffer(line, len);

  // Flush trigger 1: WARN or above. These are exactly the lines that precede
  // the crash being diagnosed — a 30 s timer that loses them loses the point.
  if (level >= LOG_FLUSH_LEVEL) {
    flush();
    return;
  }

  // Flush trigger 2: buffer at half capacity.
  if (_bufferLen >= LOG_BUFFER_BYTES / 2) {
    flush();
  }
}

void LogManager::appendToBuffer(const char* line, int len) {
  // +1 for the newline terminator appended at flush time.
  if (_bufferLen + len + 1 > LOG_BUFFER_BYTES) {
    // Buffer full between flushes. Flush now and retry once; if it still does
    // not fit the line is dropped and counted. Dropping is correct here —
    // blocking to make room would put SD latency on the caller's path, and the
    // caller may be the FIFO service loop.
    flush();
    if (_bufferLen + len + 1 > LOG_BUFFER_BYTES) {
      _droppedLines++;
      return;
    }
  }
  memcpy(_buffer + _bufferLen, line, len);
  _bufferLen += len;
  _buffer[_bufferLen++] = '\n';
}

void LogManager::tick() {
  if (!_ready || _bufferLen == 0) return;

  // Flush trigger 3: the time-based one, at whichever cadence applies.
  //
  // A reader that pulled recently is watching, and at INFO the buffer would
  // otherwise take ~37 min to hit the half-capacity trigger — so the timer is
  // the only thing that flushes, and every event sat up to 30 s before
  // becoming visible. Drop to 1 s while that is true and fall back
  // automatically once the reader goes away.
  const bool readerActive =
      _lastReadMs != 0 && (millis() - _lastReadMs) < LOG_READER_ACTIVE_MS;
  const unsigned long interval =
      readerActive ? LOG_FLUSH_INTERVAL_ACTIVE_MS : LOG_FLUSH_INTERVAL_MS;

  if (millis() - _lastFlushMs >= interval) {
    flush();
  }
}

void LogManager::flush() {
  if (!_ready || _bufferLen == 0) return;

  const int len = _bufferLen;
  // Clear the buffer BEFORE writing. A failed write must not leave the same
  // bytes queued for the next attempt: on a card that has gone away, that
  // retries forever and every subsequent log() pays for it.
  _bufferLen = 0;
  _lastFlushMs = millis();

  if (!writeToRing(_buffer, len)) {
    _writeFailures++;
    return;  // Best-effort: drop and continue. Never disturbs a recording.
  }
  writeHeader();
}

// Copy `len` bytes into the ring, honouring the wrap discipline in log_ring.h.
//
// The staging buffer holds whole newline-terminated lines, so it is written as
// a unit rather than line by line — one seek and one or two write() calls per
// flush instead of one per record. The wrap case splits it at a line boundary
// only if the buffer itself straddles the end: logPlaceLine() is applied to
// the whole buffer, so a wrap pads the tail and restarts the entire buffer at
// offset 0, losing at most the final partial line of the previous lap.
bool LogManager::writeToRing(const char* data, int len) {
  if (!_file) return false;

  const LogPlacement p = logPlaceLine(_writeOffset, LOG_RING_BYTES, (uint32_t)len - 1);

  if (p.padBytes > 0) {
    // Fill the tail with newlines so the decoder sees zero-length fragments it
    // can drop, rather than a record split across the wrap boundary.
    if (!_file.seek(LOG_HEADER_SIZE + _writeOffset)) return false;
    uint8_t pad[64];
    memset(pad, '\n', sizeof(pad));
    uint32_t remaining = p.padBytes;
    while (remaining > 0) {
      const uint32_t chunk = remaining > sizeof(pad) ? sizeof(pad) : remaining;
      if (_file.write(pad, chunk) != chunk) return false;
      remaining -= chunk;
    }
  }

  if (!_file.seek(LOG_HEADER_SIZE + p.lineStart)) return false;
  if (_file.write((const uint8_t*)data, len) != (size_t)len) return false;
  _file.flush();

  _writeOffset = p.nextOffset;
  _totalWritten += p.advance;
  return true;
}

void LogManager::writeHeader() {
  if (!_file) return;
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, _writeOffset, _totalWritten, LOG_RING_BYTES);
  if (!_file.seek(0)) return;
  _file.write(header, LOG_HEADER_SIZE);
  _file.flush();
}

// ===== Reader support =====

int LogManager::readFrom(uint64_t& readerPos, uint8_t* out, int maxBytes,
                         uint64_t& gapBytes) {
  gapBytes = 0;
  if (!_ready || !_file) return 0;

  // Mark the reader active: somebody is watching, so buffered lines are
  // user-visible lag rather than just crash exposure.
  _lastReadMs = millis();

  // Flush before serving. Readers read from the FILE — one buffer, one
  // retention policy — so anything still staged in RAM is invisible to them.
  // Without this the first pull after an event always misses it and the
  // adaptive interval above only helps from the second pull onward.
  if (_bufferLen > 0) flush();

  // Everything buffered but unflushed is invisible to a reader by design:
  // readers read from the file, so there is exactly one retention policy. A
  // reader tailing live sees the buffered lines on the next flush, which for
  // WARN+ is immediate.
  const LogReadPlan plan = logPlanRead(readerPos, _totalWritten, LOG_RING_BYTES);
  gapBytes = plan.gapBytes;
  if (plan.available == 0) {
    readerPos = plan.fromPos;
    return 0;
  }

  uint32_t want = plan.available;
  if (want > (uint32_t)maxBytes) want = (uint32_t)maxBytes;

  // The read may straddle the end of the region; split it in two.
  const uint32_t startOff = logOffsetForPos(plan.fromPos, LOG_RING_BYTES);
  const uint32_t toEnd = logBytesToEnd(startOff, LOG_RING_BYTES);
  const uint32_t first = want < toEnd ? want : toEnd;

  if (!_file.seek(LOG_HEADER_SIZE + startOff)) return 0;
  int got = _file.read(out, first);
  if (got < 0) return 0;
  if ((uint32_t)got == first && want > first) {
    if (_file.seek(LOG_HEADER_SIZE)) {
      const int more = _file.read(out + first, want - first);
      if (more > 0) got += more;
    }
  }

  // Bytes of the window the reader's position advances over. A lapped read
  // consumes its leading fragment (it can never be completed); a trailing
  // fragment is NOT consumed, so the next read starts at that line's first byte.
  uint64_t consumed = 0;

  // After a lap skip the position lands mid-line. Discard the fragment so the
  // caller never sees a truncated record. Only on a lap: a normal sequential
  // read already starts line-aligned, and scanning there would eat a good line.
  if (plan.lapped && got > 0) {
    const uint32_t skip = logSkipPartialLine(out, (uint32_t)got);
    if (skip >= (uint32_t)got) {
      // The whole window was one unterminated fragment. Consume it and return
      // nothing; the next call resumes past it.
      readerPos = plan.fromPos + (uint64_t)got;
      return 0;
    }
    memmove(out, out + skip, (size_t)got - skip);
    got -= (int)skip;
    consumed += skip;
  }

  // Trim the trailing partial line. A chunked read cuts wherever maxBytes
  // falls, which is mid-line most of the time — without this the caller
  // receives e.g. "1180 W BLE client disconnected with a t" as a whole record.
  // The remainder is not lost: the position advances only over what is
  // returned, so the next read begins at the start of that line.
  const uint32_t keep = logTrimToLastLine(out, (uint32_t)got);
  if (keep == 0) {
    // No complete line in the window. Do not advance past a line that may yet
    // be completed — unless nothing could ever complete it, which is the case
    // only when the window already spans everything the writer has produced.
    if ((uint32_t)got >= plan.available && plan.available > 0) {
      readerPos = plan.fromPos + consumed + (uint64_t)got;
    } else {
      readerPos = plan.fromPos + consumed;
    }
    return 0;
  }
  got = (int)keep;
  consumed += keep;

  readerPos = plan.fromPos + consumed;
  return got;
}
