/*
 * Host tests for the diagnostic log ring's pure logic.
 *
 * Covers what log_manager.cpp delegates to log_ring.h: offset arithmetic, the
 * wrap boundary, lap detection, mid-line recovery, level filtering, and header
 * round-tripping. The SD calls themselves (seek/write/read) stay untested here
 * for the same reason the VTX suite does not mock `File` — mocking SD would
 * test the mock.
 *
 * Run: make test-log   (or `make test` for everything)
 */

#include "test_harness.h"
#include "../imu_manager_v2/log_ring.h"

// A small ring makes wrap and lap behaviour reachable in a test without
// allocating 10 MB. The arithmetic is size-independent; LOG_RING_BYTES is
// exercised separately in header_round_trips_at_production_geometry.
static const uint32_t kRing = 256;

// ===== Level filtering =====

TEST(level_ordering_is_numeric_and_ascending) {
  // The filter is a >= comparison, so the enum order IS the severity order.
  EXPECT_TRUE(LOG_DEBUG < LOG_INFO);
  EXPECT_TRUE(LOG_INFO < LOG_WARN);
  EXPECT_TRUE(LOG_WARN < LOG_ERROR);
}

TEST(level_filter_admits_at_and_above_minimum) {
  EXPECT_TRUE(logLevelPasses(LOG_WARN, LOG_WARN));
  EXPECT_TRUE(logLevelPasses(LOG_ERROR, LOG_WARN));
  EXPECT_TRUE(!logLevelPasses(LOG_INFO, LOG_WARN));
  EXPECT_TRUE(!logLevelPasses(LOG_DEBUG, LOG_WARN));

  // The device floor is INFO: event-level lines are ALWAYS recorded (~18 KB
  // over a 3 h ride against a 10 MB ring), and DEBUG is the only optional tier
  // because it is the only one that scales with loop rate.
  EXPECT_TRUE(logLevelPasses(LOG_INFO, LOG_DEFAULT_MIN_LEVEL));
  EXPECT_TRUE(logLevelPasses(LOG_WARN, LOG_DEFAULT_MIN_LEVEL));
  EXPECT_TRUE(logLevelPasses(LOG_ERROR, LOG_DEFAULT_MIN_LEVEL));
  EXPECT_TRUE(!logLevelPasses(LOG_DEBUG, LOG_DEFAULT_MIN_LEVEL));
}

// The firmware clamps _minLevel to LOG_MAX_MIN_LEVEL so the device can never
// be configured to hide events. Pin that the constants express that intent.
TEST(device_floor_never_hides_event_level_lines) {
  EXPECT_EQ_INT(LOG_DEFAULT_MIN_LEVEL, LOG_INFO);
  EXPECT_EQ_INT(LOG_MAX_MIN_LEVEL, LOG_INFO);
  // Whatever a caller asks for, the clamped result still admits INFO+.
  for (uint8_t req = 0; req <= LOG_ERROR; req++) {
    const uint8_t applied = req > LOG_MAX_MIN_LEVEL ? (uint8_t)LOG_MAX_MIN_LEVEL : req;
    if (!logLevelPasses(LOG_INFO, applied)) {
      FAIL_MSG("request %u clamped to %u would hide INFO", req, applied);
    }
  }
}

TEST(level_filter_at_debug_admits_everything) {
  EXPECT_TRUE(logLevelPasses(LOG_DEBUG, LOG_DEBUG));
  EXPECT_TRUE(logLevelPasses(LOG_INFO, LOG_DEBUG));
  EXPECT_TRUE(logLevelPasses(LOG_WARN, LOG_DEBUG));
  EXPECT_TRUE(logLevelPasses(LOG_ERROR, LOG_DEBUG));
}

TEST(level_chars_round_trip) {
  const uint8_t levels[] = {LOG_DEBUG, LOG_INFO, LOG_WARN, LOG_ERROR};
  for (uint8_t lv : levels) {
    uint8_t back = 0xFF;
    ASSERT_TRUE(logLevelFromChar(logLevelChar(lv), &back));
    EXPECT_EQ_INT(back, lv);
  }
}

TEST(unknown_level_char_is_rejected_not_defaulted) {
  // Bucketing an unrecognised tag as DEBUG would let a corrupt line read as a
  // valid low-severity one. The decoder must be able to tell the difference.
  uint8_t out = 0xFF;
  EXPECT_TRUE(!logLevelFromChar('X', &out));
  EXPECT_TRUE(!logLevelFromChar('\0', &out));
  EXPECT_TRUE(!logLevelFromChar('d', &out));  // case-sensitive
  EXPECT_EQ_INT(out, 0xFF);                   // output untouched on failure
}

// ===== Line formatting =====

TEST(format_line_layout_is_millis_level_tag_message) {
  char line[LOG_LINE_MAX];
  int n = logFormatLine(line, sizeof(line), 123456, LOG_WARN, "CLK",
                        "sync request timed out");
  EXPECT_EQ_STR(line, "123456 W CLK sync request timed out");
  EXPECT_EQ_INT(n, (int)strlen("123456 W CLK sync request timed out"));
}

TEST(format_line_never_emits_an_embedded_newline) {
  // A newline inside the message would frame a second, headerless record and
  // desynchronise every line after it.
  char line[LOG_LINE_MAX];
  int n = logFormatLine(line, sizeof(line), 10, LOG_ERROR, "SD", "a\nb\r\nc");
  for (int i = 0; i < n; i++) {
    if (line[i] == '\n' || line[i] == '\r') {
      FAIL_MSG("newline survived at %d in \"%s\"", i, line);
    }
  }
  EXPECT_EQ_STR(line, "10 E SD a b  c");
}

TEST(format_line_truncates_rather_than_overflowing) {
  char big[LOG_LINE_MAX * 3];
  memset(big, 'x', sizeof(big) - 1);
  big[sizeof(big) - 1] = '\0';

  char line[64];
  int n = logFormatLine(line, sizeof(line), 1, LOG_INFO, "REC", big);
  EXPECT_TRUE(n < (int)sizeof(line));
  EXPECT_EQ_INT((int)strlen(line), n);
  // Truncated, but still identifiable: timestamp, level and tag survive.
  EXPECT_TRUE(strncmp(line, "1 I REC ", 8) == 0);
}

// ===== Placement: the no-wrap case =====

TEST(line_that_fits_does_not_pad_and_advances_by_line_plus_newline) {
  LogPlacement p = logPlaceLine(/*writeOffset=*/10, kRing, /*lineLen=*/20);
  EXPECT_EQ_INT(p.padBytes, 0);
  EXPECT_EQ_INT(p.lineStart, 10);
  EXPECT_EQ_INT(p.advance, 21);     // 20 + newline
  EXPECT_EQ_INT(p.nextOffset, 31);
}

TEST(placement_from_zero_offset) {
  LogPlacement p = logPlaceLine(0, kRing, 40);
  EXPECT_EQ_INT(p.padBytes, 0);
  EXPECT_EQ_INT(p.lineStart, 0);
  EXPECT_EQ_INT(p.nextOffset, 41);
  EXPECT_EQ_INT(p.advance, 41);
}

// ===== Placement: the wrap boundary =====

TEST(line_exactly_filling_the_region_does_not_pad) {
  // The boundary case that an off-by-one gets wrong in either direction: the
  // line plus its newline lands exactly on the last byte. No padding is
  // needed, and the next write belongs at offset 0, not at kRing.
  const uint32_t lineLen = 9;
  const uint32_t off = kRing - (lineLen + 1);
  LogPlacement p = logPlaceLine(off, kRing, lineLen);
  EXPECT_EQ_INT(p.padBytes, 0);
  EXPECT_EQ_INT(p.lineStart, off);
  EXPECT_EQ_INT(p.advance, lineLen + 1);
  EXPECT_EQ_INT(p.nextOffset, 0);   // wrapped to 0, NOT left at kRing
}

TEST(line_one_byte_too_long_pads_the_tail_and_restarts_at_zero) {
  // One byte past the exact fit: now it must wrap.
  const uint32_t lineLen = 9;
  const uint32_t off = kRing - lineLen;  // leaves lineLen bytes, needs lineLen+1
  LogPlacement p = logPlaceLine(off, kRing, lineLen);
  EXPECT_EQ_INT(p.padBytes, lineLen);   // fill the remainder
  EXPECT_EQ_INT(p.lineStart, 0);        // line restarts at the region start
  EXPECT_EQ_INT(p.nextOffset, lineLen + 1);
  // Padding is consumed capacity and must count toward total_written, or a
  // reader's position arithmetic drifts from the writer's on every wrap.
  EXPECT_EQ_INT(p.advance, lineLen + lineLen + 1);
}

TEST(wrap_padding_plus_line_advances_exactly_to_the_next_offset) {
  // Whatever the split, total_written must advance so that
  // (start + advance) % ring == nextOffset. This is the invariant the reader
  // depends on; check it across every offset in a small ring.
  for (uint32_t off = 0; off < kRing; off++) {
    for (uint32_t len = 1; len < 40; len++) {
      LogPlacement p = logPlaceLine(off, kRing, len);
      const uint32_t predicted = (uint32_t)(((uint64_t)off + p.advance) % kRing);
      if (predicted != p.nextOffset) {
        FAIL_MSG("off=%u len=%u: advance %u gives %u, nextOffset says %u",
                 off, len, p.advance, predicted, p.nextOffset);
        return;
      }
    }
  }
}

TEST(a_line_never_straddles_the_region_end) {
  // The core guarantee: the line itself always lies within the region, so a
  // decoder never sees a record split across the boundary.
  for (uint32_t off = 0; off < kRing; off++) {
    for (uint32_t len = 1; len < 40; len++) {
      LogPlacement p = logPlaceLine(off, kRing, len);
      if (p.lineStart + len + 1 > kRing) {
        FAIL_MSG("off=%u len=%u: line at %u..%u exceeds ring %u",
                 off, len, p.lineStart, p.lineStart + len + 1, kRing);
        return;
      }
    }
  }
}

// ===== Lap detection =====

TEST(reader_fully_caught_up_reads_nothing) {
  LogReadPlan r = logPlanRead(/*readerPos=*/500, /*totalWritten=*/500, kRing);
  EXPECT_EQ_INT(r.available, 0);
  EXPECT_EQ_INT((long long)r.gapBytes, 0);
  EXPECT_TRUE(!r.lapped);
}

TEST(reader_behind_but_inside_the_ring_loses_nothing) {
  LogReadPlan r = logPlanRead(/*readerPos=*/400, /*totalWritten=*/500, kRing);
  EXPECT_EQ_INT((long long)r.fromPos, 400);   // exact position preserved
  EXPECT_EQ_INT(r.available, 100);
  EXPECT_EQ_INT((long long)r.gapBytes, 0);
  EXPECT_TRUE(!r.lapped);
}

TEST(reader_exactly_one_ring_behind_is_the_last_safe_position) {
  // Boundary: exactly ring_size behind is still entirely readable. One more
  // byte and the oldest byte is gone.
  LogReadPlan r = logPlanRead(/*readerPos=*/1000, /*totalWritten=*/1000 + kRing, kRing);
  EXPECT_TRUE(!r.lapped);
  EXPECT_EQ_INT((long long)r.gapBytes, 0);
  EXPECT_EQ_INT(r.available, kRing);
  EXPECT_EQ_INT((long long)r.fromPos, 1000);
}

TEST(reader_one_byte_past_a_lap_reports_a_one_byte_gap) {
  LogReadPlan r = logPlanRead(/*readerPos=*/1000, /*totalWritten=*/1001 + kRing, kRing);
  EXPECT_TRUE(r.lapped);
  EXPECT_EQ_INT((long long)r.gapBytes, 1);
  // Skips to the oldest surviving byte: one full ring back from the head.
  EXPECT_EQ_INT((long long)r.fromPos, 1001);
  EXPECT_EQ_INT(r.available, kRing);
}

TEST(lapped_reader_reports_the_gap_rather_than_silently_resyncing) {
  // The requirement: never silently resync. A reader 5,000 bytes behind on a
  // 256-byte ring has lost 5000-256 bytes and must be told the number.
  LogReadPlan r = logPlanRead(/*readerPos=*/0, /*totalWritten=*/5000, kRing);
  EXPECT_TRUE(r.lapped);
  EXPECT_EQ_INT((long long)r.gapBytes, 5000 - kRing);
  EXPECT_EQ_INT((long long)r.fromPos, 5000 - kRing);
  EXPECT_EQ_INT(r.available, kRing);
}

TEST(reader_ahead_of_the_writer_is_clamped_not_wrapped) {
  // Happens when the log is reset (or the reader holds a position from a
  // different file). Unsigned arithmetic on totalWritten - readerPos would
  // produce a ~1.8e19 span; it must clamp to "caught up" instead.
  LogReadPlan r = logPlanRead(/*readerPos=*/9000, /*totalWritten=*/100, kRing);
  EXPECT_EQ_INT(r.available, 0);
  EXPECT_EQ_INT((long long)r.fromPos, 100);
  EXPECT_TRUE(!r.lapped);
}

TEST(lap_detection_holds_at_production_ring_size) {
  // The small-ring tests above prove the arithmetic; this proves it does not
  // overflow at the real 10 MB geometry with a multi-gigabyte total.
  const uint64_t total = 4ULL * 1024 * 1024 * 1024;  // 4 GB written
  LogReadPlan r = logPlanRead(0, total, LOG_RING_BYTES);
  EXPECT_TRUE(r.lapped);
  EXPECT_EQ_INT((long long)r.gapBytes, (long long)(total - LOG_RING_BYTES));
  EXPECT_EQ_INT(r.available, LOG_RING_BYTES);
  EXPECT_EQ_INT((long long)r.fromPos, (long long)(total - LOG_RING_BYTES));
}

TEST(offset_for_position_wraps_modulo_the_region) {
  EXPECT_EQ_INT(logOffsetForPos(0, kRing), 0);
  EXPECT_EQ_INT(logOffsetForPos(kRing - 1, kRing), kRing - 1);
  EXPECT_EQ_INT(logOffsetForPos(kRing, kRing), 0);
  EXPECT_EQ_INT(logOffsetForPos(kRing + 5, kRing), 5);
  // Large positions must not overflow on the way to the modulo.
  EXPECT_EQ_INT(logOffsetForPos(4ULL * 1024 * 1024 * 1024, LOG_RING_BYTES),
                (uint32_t)((4ULL * 1024 * 1024 * 1024) % LOG_RING_BYTES));
}

// ===== Mid-line recovery =====

TEST(skip_partial_line_discards_the_fragment_and_its_newline) {
  const char* buf = "gment of a line\n1234 W CLK real line\n";
  uint32_t skip = logSkipPartialLine((const uint8_t*)buf, (uint32_t)strlen(buf));
  EXPECT_EQ_INT(skip, 16);  // "gment of a line" + '\n'
  EXPECT_EQ_STR(buf + skip, "1234 W CLK real line\n");
}

TEST(skip_partial_line_on_a_buffer_starting_with_newline_skips_one_byte) {
  // Landing exactly on a terminator: the fragment is zero-length and only the
  // newline is consumed.
  const char* buf = "\nreal line\n";
  EXPECT_EQ_INT(logSkipPartialLine((const uint8_t*)buf, (uint32_t)strlen(buf)), 1);
}

TEST(skip_partial_line_with_no_newline_consumes_the_whole_window) {
  // The caller reads more rather than treating the fragment as a record.
  const char* buf = "no terminator here";
  const uint32_t len = (uint32_t)strlen(buf);
  EXPECT_EQ_INT(logSkipPartialLine((const uint8_t*)buf, len), len);
}

TEST(wrap_padding_reads_as_droppable_empty_fragments) {
  // Newline is the pad byte precisely so a decoder splitting on '\n' yields
  // empty strings for padding and drops them without knowing where the pad
  // region was. Walk a padded boundary the way the decoder does.
  const char pad[] = "tail\n\n\n\n\n100 W SD next\n";
  uint32_t i = logSkipPartialLine((const uint8_t*)pad, (uint32_t)strlen(pad));
  EXPECT_EQ_INT(i, 5);  // "tail\n"
  int empties = 0;
  while (i < strlen(pad) && pad[i] == '\n') { i++; empties++; }
  EXPECT_EQ_INT(empties, 4);
  EXPECT_EQ_STR(pad + i, "100 W SD next\n");
}

// ===== Trailing-fragment trim =====
//
// The complement of logSkipPartialLine(). A chunked read cuts wherever the
// chunk size falls, which is mid-line most of the time; without the trim the
// caller receives a truncated record as if it were whole.

TEST(trim_to_last_line_drops_a_trailing_fragment) {
  const char* buf = "100 W CLK complete\n200 W BLE client disconn";
  const uint32_t keep = logTrimToLastLine((const uint8_t*)buf, (uint32_t)strlen(buf));
  EXPECT_EQ_INT(keep, 19);  // through the first newline only
  char out[64];
  memcpy(out, buf, keep);
  out[keep] = '\0';
  EXPECT_EQ_STR(out, "100 W CLK complete\n");
}

TEST(trim_to_last_line_keeps_a_window_ending_on_a_newline) {
  const char* buf = "100 W CLK a\n200 W CLK b\n";
  const uint32_t len = (uint32_t)strlen(buf);
  EXPECT_EQ_INT(logTrimToLastLine((const uint8_t*)buf, len), len);
}

TEST(trim_to_last_line_returns_zero_when_no_line_is_complete) {
  // No newline anywhere: no complete line is available yet, so the caller must
  // read further rather than emit the fragment.
  const char* buf = "200 W BLE client disconn";
  EXPECT_EQ_INT(logTrimToLastLine((const uint8_t*)buf, (uint32_t)strlen(buf)), 0);
}

TEST(trim_and_skip_are_complements_over_a_window) {
  // skip drops a fragment at the START, trim drops one at the END. Applied
  // together they leave only whole lines.
  const char* buf = "ragment\n100 W CLK whole\n200 W CLK part";
  const uint32_t len = (uint32_t)strlen(buf);
  const uint32_t skip = logSkipPartialLine((const uint8_t*)buf, len);
  const uint32_t keep = logTrimToLastLine((const uint8_t*)(buf + skip), len - skip);
  char out[80];
  memcpy(out, buf + skip, keep);
  out[keep] = '\0';
  EXPECT_EQ_STR(out, "100 W CLK whole\n");
}

TEST(chunked_reader_never_receives_a_truncated_record) {
  // The bug this guards: a 180-byte BLE chunk cutting mid-line delivered
  // "1180 W BLE client disconnected with a t" as a whole record. Drive the
  // real trim over a stream of lines at a chunk size that misaligns, and
  // assert every delivered record parses and that none is lost.
  const char* lines[] = {
    "1000 W CLK sync request timed out (1 missed)",
    "1060 E REC SD write failed (18 MB free) - stopping",
    "1120 W CLK sync request timed out (3 missed)",
    "1180 W BLE client disconnected with a time request in flight",
    "1240 E REC stopped - 0 sync records, 156 sync misses",
  };
  const int kCount = 5;

  char stream[1024];
  uint32_t total = 0;
  for (int i = 0; i < kCount; i++) {
    const uint32_t n = (uint32_t)strlen(lines[i]);
    memcpy(stream + total, lines[i], n);
    total += n;
    stream[total++] = '\n';
  }

  const uint32_t kChunk = 180;  // LOG_BLE_CHUNK_BYTES
  uint32_t pos = 0;
  int delivered = 0;
  int guard = 0;
  while (pos < total && guard++ < 100) {
    uint32_t want = total - pos;
    if (want > kChunk) want = kChunk;

    const uint32_t keep = logTrimToLastLine((const uint8_t*)(stream + pos), want);
    if (keep == 0) {
      // Only legitimate when the window could still be completed by a later
      // write; here the stream is finite, so it must not happen.
      FAIL_MSG("no complete line in a %u-byte window at %u", want, pos);
      return;
    }

    // Every byte handed to the caller must end on a line boundary, and each
    // record inside must match what was written.
    if (stream[pos + keep - 1] != '\n') {
      FAIL_MSG("chunk at %u does not end on a newline", pos);
      return;
    }
    uint32_t i = 0;
    while (i < keep) {
      uint32_t end = i;
      while (end < keep && stream[pos + end] != '\n') end++;
      char rec[128];
      const uint32_t n = end - i;
      memcpy(rec, stream + pos + i, n);
      rec[n] = '\0';
      if (delivered >= kCount) {
        FAIL_MSG("delivered more records than were written");
        return;
      }
      EXPECT_EQ_STR(rec, lines[delivered]);
      delivered++;
      i = end + 1;
    }
    pos += keep;
  }

  // Every record delivered exactly once, none truncated, none dropped.
  EXPECT_EQ_INT(delivered, kCount);
  EXPECT_EQ_INT(pos, total);
}

// ===== Header round trip =====

TEST(header_round_trips) {
  uint8_t header[LOG_HEADER_SIZE];
  memset(header, 0xAA, sizeof(header));  // poison: prove the writer clears
  logWriteHeader(header, 1234, 99999ULL, kRing);

  EXPECT_BYTES_EQ(header + LOG_OFF_MAGIC, "VLOG", 4);
  EXPECT_EQ_INT(logGetU16(header + LOG_OFF_VERSION), LOG_FORMAT_VERSION);
  EXPECT_EQ_INT(logGetU16(header + LOG_OFF_RESERVED_6), 0);
  EXPECT_EQ_INT(logGetU32(header + LOG_OFF_WRITE_OFFSET), 1234);
  EXPECT_EQ_INT((long long)logGetU64(header + LOG_OFF_TOTAL_WRITTEN), 99999);
  EXPECT_EQ_INT(logGetU32(header + LOG_OFF_RING_BYTES), kRing);
  // Reserved tail must be cleared, not left poisoned.
  for (int i = 24; i < LOG_HEADER_SIZE; i++) EXPECT_EQ_INT(header[i], 0);
}

TEST(header_read_accepts_a_consistent_header) {
  uint8_t header[LOG_HEADER_SIZE];
  // 99999 % 256 == 31, so write_offset must be 31 to be self-consistent.
  logWriteHeader(header, 99999 % kRing, 99999ULL, kRing);

  uint32_t off = 0;
  uint64_t total = 0;
  ASSERT_TRUE(logReadHeader(header, &off, &total, kRing));
  EXPECT_EQ_INT(off, 99999 % kRing);
  EXPECT_EQ_INT((long long)total, 99999);
}

TEST(header_read_rejects_bad_magic) {
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 0, 0, kRing);
  header[0] = 'X';
  uint32_t off = 7; uint64_t total = 7;
  EXPECT_TRUE(!logReadHeader(header, &off, &total, kRing));
  EXPECT_EQ_INT(off, 7);  // outputs untouched on rejection
}

TEST(header_read_rejects_a_different_version) {
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 0, 0, kRing);
  logPutU16(header + LOG_OFF_VERSION, LOG_FORMAT_VERSION + 1);
  uint32_t off; uint64_t total;
  EXPECT_TRUE(!logReadHeader(header, &off, &total, kRing));
}

TEST(header_read_rejects_a_changed_ring_size) {
  // The check that matters in practice: a ring written with a different
  // LOG_RING_BYTES has stored offsets meaning something else. Rejecting turns
  // a constant change into a fresh log rather than a mis-parsed one.
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 10, 10, kRing);
  uint32_t off; uint64_t total;
  EXPECT_TRUE(!logReadHeader(header, &off, &total, kRing * 2));
}

TEST(header_read_rejects_an_offset_outside_the_region) {
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 0, 0, kRing);
  logPutU32(header + LOG_OFF_WRITE_OFFSET, kRing);  // one past the end
  uint32_t off; uint64_t total;
  EXPECT_TRUE(!logReadHeader(header, &off, &total, kRing));
}

TEST(header_read_rejects_offset_disagreeing_with_total) {
  // If the pair is inconsistent one of them is corrupt, and every reader
  // position derived from it is wrong. Better to start fresh.
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 5, 1000, kRing);  // 1000 % 256 == 232, not 5
  uint32_t off; uint64_t total;
  EXPECT_TRUE(!logReadHeader(header, &off, &total, kRing));
}

TEST(header_round_trips_at_production_geometry) {
  // Beyond 4 GB, where a 32-bit total_written would have silently wrapped.
  uint8_t header[LOG_HEADER_SIZE];
  const uint64_t total = 5ULL * 1024 * 1024 * 1024 + 12345;
  logWriteHeader(header, (uint32_t)(total % LOG_RING_BYTES), total, LOG_RING_BYTES);

  uint32_t off = 0; uint64_t back = 0;
  ASSERT_TRUE(logReadHeader(header, &off, &back, LOG_RING_BYTES));
  EXPECT_EQ_INT((long long)back, (long long)total);
  EXPECT_EQ_INT(off, (uint32_t)(total % LOG_RING_BYTES));
}

TEST(fresh_header_is_a_valid_empty_ring) {
  uint8_t header[LOG_HEADER_SIZE];
  logWriteHeader(header, 0, 0, LOG_RING_BYTES);
  uint32_t off = 9; uint64_t total = 9;
  ASSERT_TRUE(logReadHeader(header, &off, &total, LOG_RING_BYTES));
  EXPECT_EQ_INT(off, 0);
  EXPECT_EQ_INT((long long)total, 0);
}

// ===== End-to-end simulation =====
//
// Drive the placement arithmetic over a simulated ring and read it back, which
// is the only way to catch an error that is self-consistent within one
// function but wrong across the write/read pair.

TEST(simulated_ring_survives_many_wraps_and_reads_back_in_order) {
  uint8_t ring[kRing];
  memset(ring, 0, sizeof(ring));
  uint32_t writeOffset = 0;
  uint64_t totalWritten = 0;

  // Write 200 numbered lines through the real placement logic.
  const int kLines = 200;
  for (int i = 0; i < kLines; i++) {
    char line[LOG_LINE_MAX];
    int len = logFormatLine(line, sizeof(line), (uint32_t)i, LOG_WARN, "SIM",
                            "line");
    LogPlacement p = logPlaceLine(writeOffset, kRing, (uint32_t)len);
    for (uint32_t j = 0; j < p.padBytes; j++) ring[writeOffset + j] = '\n';
    memcpy(ring + p.lineStart, line, (size_t)len);
    ring[p.lineStart + len] = '\n';
    writeOffset = p.nextOffset;
    totalWritten += p.advance;
  }

  // A reader starting at 0 is far lapped by now.
  LogReadPlan plan = logPlanRead(0, totalWritten, kRing);
  ASSERT_TRUE(plan.lapped);
  EXPECT_EQ_INT((long long)plan.gapBytes, (long long)(totalWritten - kRing));

  // Linearise the ring from the oldest surviving byte, as the decoder does.
  uint8_t linear[kRing];
  const uint32_t startOff = logOffsetForPos(plan.fromPos, kRing);
  for (uint32_t i = 0; i < kRing; i++) linear[i] = ring[(startOff + i) % kRing];

  // Drop the leading fragment, then parse the surviving lines.
  uint32_t i = logSkipPartialLine(linear, kRing);
  int seen = 0;
  long lastIdx = -1;
  while (i < kRing) {
    uint32_t end = i;
    while (end < kRing && linear[end] != '\n') end++;
    if (end == kRing) break;  // trailing fragment at the write head
    if (end > i) {
      char rec[LOG_LINE_MAX];
      const uint32_t n = end - i;
      memcpy(rec, linear + i, n);
      rec[n] = '\0';

      long idx = -1;
      char lv = '?', tag[16] = {0};
      if (sscanf(rec, "%ld %c %15s", &idx, &lv, tag) != 3) {
        FAIL_MSG("unparseable record: \"%s\"", rec);
        return;
      }
      EXPECT_EQ_INT(lv, 'W');
      EXPECT_EQ_STR(tag, "SIM");
      // Chronological and contiguous: the ring must not reorder or skip.
      if (lastIdx >= 0 && idx != lastIdx + 1) {
        FAIL_MSG("out of order: %ld followed %ld", idx, lastIdx);
        return;
      }
      lastIdx = idx;
      seen++;
    }
    i = end + 1;
  }

  EXPECT_TRUE(seen > 0);
  // The newest line written must be among the survivors (modulo the trailing
  // fragment at the head), proving the ring keeps the RECENT past, not the
  // oldest.
  EXPECT_TRUE(lastIdx >= kLines - 2);
}

TEST(simulated_reader_tailing_live_never_reports_a_gap) {
  // A reader that keeps up sees every byte exactly once, with no gap ever
  // reported — the normal case that must not be disturbed by lap handling.
  uint32_t writeOffset = 0;
  uint64_t totalWritten = 0;
  uint64_t readerPos = 0;
  uint64_t consumed = 0;

  for (int i = 0; i < 500; i++) {
    char line[LOG_LINE_MAX];
    int len = logFormatLine(line, sizeof(line), (uint32_t)i, LOG_INFO, "SIM", "x");
    LogPlacement p = logPlaceLine(writeOffset, kRing, (uint32_t)len);
    writeOffset = p.nextOffset;
    totalWritten += p.advance;

    // Reader drains fully after each write.
    LogReadPlan r = logPlanRead(readerPos, totalWritten, kRing);
    if (r.lapped) {
      FAIL_MSG("reader keeping up reported a lap at line %d", i);
      return;
    }
    consumed += r.available;
    readerPos = r.fromPos + r.available;
  }

  EXPECT_EQ_INT((long long)readerPos, (long long)totalWritten);
  EXPECT_EQ_INT((long long)consumed, (long long)totalWritten);
}

int main() {
  return vtxtest::runAllTests("log ring — offsets, wrap, laps, levels");
}
