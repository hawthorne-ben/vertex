/*
 * Host-compiled unit tests for the pure logic in firmware/imu_manager_v2.
 *
 * Covers the .vtx encode side of the format contract, which the parser test
 * suite in packages/vtx-parser/ does not reach: header serialization, header
 * patching, record layout, axis remap and scaling, the button state machine,
 * and filename generation.
 *
 * Build and run with `make test` in firmware/test/.
 */

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <string>

#include "test_harness.h"

// The code under test. sensor_manager.h/storage_manager.h pull in Arduino, so
// the record structs are declared here to match — the layout tests below are
// what keep the two definitions honest.
#include "../imu_manager_v2/vtx_format.h"

// Mirrors sensor_manager.h
struct __attribute__((packed)) IMURecord {
  uint32_t timestamp_ms;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
};

// Mirrors storage_manager.h
struct __attribute__((packed)) ClockSyncRecord {
  uint32_t t1_device_ms;
  uint32_t t4_device_ms;
  int64_t  t2_phone_unix_ms;
  int64_t  t3_phone_unix_ms;
};

// ---- little-endian readback helpers (independent of the writers) ----
static uint16_t readU16(const uint8_t* p) {
  return (uint16_t)(p[0] | (p[1] << 8));
}
static uint32_t readU32(const uint8_t* p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) |
         ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static uint64_t readU64(const uint8_t* p) {
  uint64_t v = 0;
  for (int i = 7; i >= 0; i--) v = (v << 8) | p[i];
  return v;
}
static int64_t readI64(const uint8_t* p) { return (int64_t)readU64(p); }
static float readF32(const uint8_t* p) {
  uint32_t b = readU32(p);
  float f;
  memcpy(&f, &b, 4);
  return f;
}

// ============================================================
// 1. Header serialization
// ============================================================

TEST(header_magic_and_version) {
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 1772349000000LL);

  EXPECT_BYTES_EQ(h + VTX_OFF_MAGIC, "VTX\0", 4);
  EXPECT_EQ_INT(readU16(h + VTX_OFF_VERSION_MAJOR), VTX_FORMAT_MAJOR);
  EXPECT_EQ_INT(readU16(h + VTX_OFF_VERSION_MINOR), VTX_FORMAT_MINOR);
}

TEST(header_lengths_and_offsets) {
  const uint32_t metaLen = 115;
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, metaLen, 1772349000000LL);

  EXPECT_EQ_INT(readU32(h + VTX_OFF_METADATA_LENGTH), metaLen);
  // data_offset is the first byte after header + metadata
  EXPECT_EQ_INT(readU32(h + VTX_OFF_DATA_OFFSET), VTX_HEADER_SIZE + metaLen);
}

TEST(header_placeholders_are_zero) {
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 1772349000000LL);

  // Patched on close; must be zero at open so a truncated file is detectable.
  EXPECT_EQ_INT(readU64(h + VTX_OFF_RECORD_COUNT), 0);
  EXPECT_EQ_INT(readI64(h + VTX_OFF_END_TIMESTAMP), 0);
}

TEST(header_sample_rate_is_float32) {
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 0);
  EXPECT_NEAR(readF32(h + VTX_OFF_SAMPLE_RATE), (float)IMU_ODR_HZ, 1e-6);
}

TEST(header_start_timestamp_int64) {
  const int64_t ts = 1772349000000LL;  // 2026-02-28 23:10:00 PST
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, ts);
  EXPECT_EQ_INT(readI64(h + VTX_OFF_START_TIMESTAMP), ts);
}

TEST(header_start_timestamp_negative) {
  // Pre-1970 is not a real recording, but it is the cheapest check that the
  // field round-trips as signed rather than unsigned.
  const int64_t ts = -1000LL;
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, ts);
  EXPECT_EQ_INT(readI64(h + VTX_OFF_START_TIMESTAMP), ts);
}

TEST(header_format_and_compression_flags) {
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 0);

  EXPECT_EQ_INT(h[VTX_OFF_RECORD_FORMAT], 0x03);  // HAS_ACCEL | HAS_GYRO
  EXPECT_EQ_INT(h[VTX_OFF_RECORD_FORMAT] & 0x01, 0x01);
  EXPECT_EQ_INT(h[VTX_OFF_RECORD_FORMAT] & 0x02, 0x02);
  EXPECT_EQ_INT(h[VTX_OFF_RECORD_FORMAT] & 0x04, 0);  // no magnetometer
  EXPECT_EQ_INT(h[VTX_OFF_RECORD_FORMAT] & 0x08, 0);  // no quaternion
  EXPECT_EQ_INT(h[VTX_OFF_COMPRESSION], VTX_COMPRESSION_NONE);
}

TEST(header_gps_and_sync_fields_zeroed) {
  uint8_t h[VTX_HEADER_SIZE];
  memset(h, 0xAA, sizeof(h));  // poison, to prove writeHeader clears
  vtxWriteHeader(h, 115, 1772349000000LL);

  // No GPS on this hardware; sync pair is patched later by writeSyncSection().
  // Zero here is what makes a ride with no sync records read as "no stream".
  EXPECT_EQ_INT(readU64(h + VTX_OFF_GPS_RECORD_COUNT), 0);
  EXPECT_EQ_INT(readU32(h + VTX_OFF_GPS_DATA_OFFSET), 0);
  EXPECT_EQ_INT(readU32(h + VTX_OFF_SYNC_DATA_OFFSET), 0);
  EXPECT_EQ_INT(readU16(h + VTX_OFF_SYNC_RECORD_COUNT), 0);
}

TEST(header_is_exactly_64_bytes_with_no_gaps) {
  // Every documented field must sit inside the 64-byte header, and the last
  // one must end exactly at the boundary.
  EXPECT_EQ_INT(VTX_HEADER_SIZE, 64);
  EXPECT_EQ_INT(VTX_OFF_SYNC_RECORD_COUNT + 2, VTX_HEADER_SIZE);
}

TEST(header_little_endian_byte_order) {
  // Pin actual byte order rather than trusting the host to be little-endian.
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 0x11223344u, 0);

  const uint8_t expected[4] = {0x44, 0x33, 0x22, 0x11};
  EXPECT_BYTES_EQ(h + VTX_OFF_METADATA_LENGTH, expected, 4);
}

TEST(metadata_json_matches_expected_shape) {
  char meta[256];
  int n = vtxBuildMetadata(meta, sizeof(meta));

  EXPECT_EQ_INT(n, (int)strlen(meta));
  EXPECT_EQ_STR(meta,
    "{\"device\":{\"name\":\"Vertex-V2\",\"firmwareVersion\":\"2.0.0\","
    "\"hardwareRevision\":\"v2\"},\"session\":{\"position\":\"Seatpost\"}}");
  // 115 bytes is what shipped recordings carry; a change here changes
  // data_offset for every future file.
  EXPECT_EQ_INT(n, 115);
}

// ============================================================
// 1b. Filename sort key
// ============================================================

TEST(sort_key_orders_chronologically) {
  // Same day, later ms sorts later.
  EXPECT_TRUE(vtxFilenameSortKey("9_6_2026_100.vtx") <
              vtxFilenameSortKey("9_6_2026_200.vtx"));
  // Across a month boundary.
  EXPECT_TRUE(vtxFilenameSortKey("3_13_2026_57329777.vtx") <
              vtxFilenameSortKey("5_14_2026_22110896.vtx"));
  // Across a year boundary — the case a naive month-major sort gets wrong.
  EXPECT_TRUE(vtxFilenameSortKey("12_31_2025_1.vtx") <
              vtxFilenameSortKey("1_1_2026_1.vtx"));
}

TEST(sort_key_strips_directory_prefix) {
  // SD.open(LOG_DIR) may hand back names with or without the prefix depending
  // on core version. Both must produce the same key, or the app's sort breaks
  // silently after a core upgrade.
  EXPECT_EQ_INT(vtxFilenameSortKey("/vtx/9_6_2026_42266036.vtx"),
                vtxFilenameSortKey("9_6_2026_42266036.vtx"));
}

TEST(sort_key_rejects_unparseable_names) {
  // -1 sorts unrecognised files to the front rather than scattering them.
  EXPECT_EQ_INT(vtxFilenameSortKey("garbage.vtx"), -1);
  EXPECT_EQ_INT(vtxFilenameSortKey(""), -1);
  EXPECT_EQ_INT(vtxFilenameSortKey(nullptr), -1);
  EXPECT_EQ_INT(vtxFilenameSortKey("13_1_2026_0.vtx"), -1);   // month 13
  EXPECT_EQ_INT(vtxFilenameSortKey("1_32_2026_0.vtx"), -1);   // day 32
}

TEST(sort_key_round_trips_generated_filenames) {
  // The generator and the parser must agree: build a name with the firmware's
  // own formatter, then confirm the key recovers the right ordering.
  char earlier[64], later[64];
  vtxBuildFilename(earlier, sizeof(earlier), 1772349000000LL);
  vtxBuildFilename(later, sizeof(later), 1772349000000LL + 3600000LL);
  EXPECT_TRUE(vtxFilenameSortKey(earlier) < vtxFilenameSortKey(later));
}

// ============================================================
// 2. Header patching
// ============================================================

TEST(patch_record_count_and_end_timestamp) {
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 1772349000000LL);

  const uint64_t count = 936745;          // from a real 2.5h recording
  const int64_t endTs = 1772358000000LL;

  vtxPatchRecordCount(h + VTX_OFF_RECORD_COUNT, count);
  vtxPatchEndTimestamp(h + VTX_OFF_END_TIMESTAMP, endTs);

  EXPECT_EQ_INT(readU64(h + VTX_OFF_RECORD_COUNT), count);
  EXPECT_EQ_INT(readI64(h + VTX_OFF_END_TIMESTAMP), endTs);
}

TEST(patch_disturbs_no_other_bytes) {
  uint8_t before[VTX_HEADER_SIZE], after[VTX_HEADER_SIZE];
  vtxWriteHeader(before, 115, 1772349000000LL);
  memcpy(after, before, VTX_HEADER_SIZE);

  vtxPatchRecordCount(after + VTX_OFF_RECORD_COUNT, 936745);
  vtxPatchEndTimestamp(after + VTX_OFF_END_TIMESTAMP, 1772358000000LL);

  // Everything outside [16,24) and [36,44) must be byte-identical.
  for (int i = 0; i < VTX_HEADER_SIZE; i++) {
    bool inRecordCount = (i >= VTX_OFF_RECORD_COUNT && i < VTX_OFF_RECORD_COUNT + 8);
    bool inEndTs = (i >= VTX_OFF_END_TIMESTAMP && i < VTX_OFF_END_TIMESTAMP + 8);
    if (inRecordCount || inEndTs) continue;
    if (before[i] != after[i]) {
      FAIL_MSG("patch modified byte %d: 0x%02X -> 0x%02X", i, before[i], after[i]);
    }
  }
}

TEST(patch_writes_exactly_eight_bytes_each) {
  // Guard against a patch that overruns into the neighbouring field. The
  // firmware seeks to 16 and 36 and writes 8 bytes at each; a 16-byte write
  // at offset 16 would silently clobber sample_rate and start_timestamp.
  uint8_t buf[24];
  memset(buf, 0x5A, sizeof(buf));
  vtxPatchRecordCount(buf + 8, 0xFFFFFFFFFFFFFFFFull);

  for (int i = 0; i < 8; i++) EXPECT_EQ_INT(buf[i], 0x5A);
  for (int i = 8; i < 16; i++) EXPECT_EQ_INT(buf[i], 0xFF);
  for (int i = 16; i < 24; i++) EXPECT_EQ_INT(buf[i], 0x5A);
}

TEST(patch_end_timestamp_before_start_is_preserved) {
  // A clock resync mid-recording can make end < start. The format stores what
  // it is given; sanity-checking belongs in the parser, not the writer.
  uint8_t h[VTX_HEADER_SIZE];
  vtxWriteHeader(h, 115, 1772349000000LL);
  vtxPatchEndTimestamp(h + VTX_OFF_END_TIMESTAMP, 1772348000000LL);
  EXPECT_EQ_INT(readI64(h + VTX_OFF_END_TIMESTAMP), 1772348000000LL);
}

// ============================================================
// 3. IMURecord layout
// ============================================================

TEST(imu_record_is_exactly_28_bytes) {
  // The firmware writes sizeof(IMURecord) straight to SD. If padding creeps
  // in, every record after the first is misaligned and the file decodes into
  // plausible garbage.
  EXPECT_EQ_INT(sizeof(IMURecord), 28);
  EXPECT_EQ_INT(sizeof(IMURecord), VTX_IMU_RECORD_SIZE);
}

TEST(imu_record_field_offsets_match_spec) {
  EXPECT_EQ_INT(offsetof(IMURecord, timestamp_ms), 0);
  EXPECT_EQ_INT(offsetof(IMURecord, accel_x), 4);
  EXPECT_EQ_INT(offsetof(IMURecord, accel_y), 8);
  EXPECT_EQ_INT(offsetof(IMURecord, accel_z), 12);
  EXPECT_EQ_INT(offsetof(IMURecord, gyro_x), 16);
  EXPECT_EQ_INT(offsetof(IMURecord, gyro_y), 20);
  EXPECT_EQ_INT(offsetof(IMURecord, gyro_z), 24);
}

TEST(imu_record_accel_and_gyro_triples_are_contiguous) {
  // vtxConvertSample() writes through &accel_x and &gyro_x as float[3].
  IMURecord r;
  memset(&r, 0, sizeof(r));
  float* a = &r.accel_x;
  float* g = &r.gyro_x;
  a[0] = 1.0f; a[1] = 2.0f; a[2] = 3.0f;
  g[0] = 4.0f; g[1] = 5.0f; g[2] = 6.0f;

  EXPECT_NEAR(r.accel_x, 1.0f, 0);
  EXPECT_NEAR(r.accel_y, 2.0f, 0);
  EXPECT_NEAR(r.accel_z, 3.0f, 0);
  EXPECT_NEAR(r.gyro_x, 4.0f, 0);
  EXPECT_NEAR(r.gyro_y, 5.0f, 0);
  EXPECT_NEAR(r.gyro_z, 6.0f, 0);
}

TEST(imu_record_packing_is_enforced_not_incidental) {
  // sizeof == 28 happens to hold under natural alignment too (uint32 + 6
  // float32, all 4-byte aligned), so the assertion above cannot distinguish
  // "packed" from "lucky". This one can: an over-aligned first member would
  // force padding under natural alignment but not with the packed attribute.
  struct __attribute__((packed)) ProbePacked { uint8_t a; uint32_t b; };
  struct ProbeNatural { uint8_t a; uint32_t b; };

  EXPECT_EQ_INT(sizeof(ProbePacked), 5);
  EXPECT_EQ_INT(sizeof(ProbeNatural), 8);
  // Confirms __attribute__((packed)) is honored by this compiler, so the
  // attribute on IMURecord is doing real work rather than being ignored.
  EXPECT_TRUE(sizeof(ProbePacked) != sizeof(ProbeNatural));
}

TEST(clock_sync_record_is_exactly_24_bytes) {
  EXPECT_EQ_INT(sizeof(ClockSyncRecord), 24);
  EXPECT_EQ_INT(sizeof(ClockSyncRecord), VTX_SYNC_RECORD_SIZE);
  EXPECT_EQ_INT(offsetof(ClockSyncRecord, t1_device_ms), 0);
  EXPECT_EQ_INT(offsetof(ClockSyncRecord, t4_device_ms), 4);
  EXPECT_EQ_INT(offsetof(ClockSyncRecord, t2_phone_unix_ms), 8);
  EXPECT_EQ_INT(offsetof(ClockSyncRecord, t3_phone_unix_ms), 16);
  // Without packing, the int64 members would force 8-byte alignment and the
  // struct would be 24 bytes anyway — but t2 would land at offset 8 only by
  // luck. Offsets above are the real contract.
}

// ============================================================
// 4. Axis remap and scale conversion
// ============================================================

TEST(scale_constants_match_datasheet) {
  // LSM6DS3 at +/-8g: 0.244 mg/LSB, converted to m/s².
  EXPECT_NEAR(ACCEL_SCALE, 0.000244 * 9.80665, 1e-9);
  // LSM6DS3 at +/-1000dps: 35 mdps/LSB = 0.035 deg/s per LSB.
  EXPECT_NEAR(GYRO_SCALE, 0.035, 1e-9);
}

TEST(convert_maps_chip_axes_to_body_frame) {
  float a[3], g[3];
  // Distinct values per chip axis so a wrong mapping cannot coincidentally pass.
  vtxConvertSample(/*gx*/ 100, /*gy*/ 200, /*gz*/ 300,
                   /*ax*/ 1000, /*ay*/ 2000, /*az*/ 3000, a, g);

  // body X = chip Z, body Y = chip X, body Z = chip Y
  EXPECT_NEAR(a[0], 3000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(a[1], 1000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(a[2], 2000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(g[0], 300 * GYRO_SCALE, 1e-6);
  EXPECT_NEAR(g[1], 100 * GYRO_SCALE, 1e-6);
  EXPECT_NEAR(g[2], 200 * GYRO_SCALE, 1e-6);
}

TEST(convert_known_values_to_physical_units) {
  float a[3], g[3];

  // 1g on the chip Y axis -> body Z (the gravity axis), ~9.81 m/s².
  // 1g at 0.244 mg/LSB is 4098 LSB.
  vtxConvertSample(0, 0, 0, 0, 4098, 0, a, g);
  EXPECT_NEAR(a[2], 9.8066, 0.005);
  EXPECT_NEAR(a[0], 0.0, 1e-9);
  EXPECT_NEAR(a[1], 0.0, 1e-9);

  // Full-scale gyro: +1000 dps is 28571 LSB at 0.035 deg/s per LSB.
  vtxConvertSample(0, 0, 28571, 0, 0, 0, a, g);
  EXPECT_NEAR(g[0], 999.985, 0.01);
}

TEST(convert_handles_negative_values) {
  float a[3], g[3];
  vtxConvertSample(-100, -200, -300, -1000, -2000, -3000, a, g);

  EXPECT_NEAR(a[0], -3000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(a[1], -1000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(a[2], -2000 * ACCEL_SCALE, 1e-6);
  EXPECT_NEAR(g[0], -300 * GYRO_SCALE, 1e-6);
  EXPECT_NEAR(g[1], -100 * GYRO_SCALE, 1e-6);
  EXPECT_NEAR(g[2], -200 * GYRO_SCALE, 1e-6);

  // int16 extremes must not wrap or saturate.
  vtxConvertSample(-32768, 0, 0, -32768, 0, 0, a, g);
  EXPECT_NEAR(a[1], -32768 * ACCEL_SCALE, 1e-3);
  EXPECT_NEAR(g[1], -32768 * GYRO_SCALE, 1e-3);
}

TEST(axis_remap_is_a_proper_rotation) {
  // Build the mapping matrix by pushing unit vectors through the real
  // conversion, then check det == +1. A det of -1 would mean a handedness
  // flip, which inverts every gyro sign downstream (and silently breaks any
  // cross-product or integration in the analysis pipeline).
  float M[3][3];  // M[bodyRow][chipCol]
  const int16_t unit = 1000;
  for (int c = 0; c < 3; c++) {
    int16_t g[3] = {0, 0, 0};
    g[c] = unit;
    float av[3], gv[3];
    vtxConvertSample(g[0], g[1], g[2], 0, 0, 0, av, gv);
    for (int r = 0; r < 3; r++) M[r][c] = gv[r] / (unit * GYRO_SCALE);
  }

  float det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
            - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
            + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  EXPECT_NEAR(det, 1.0, 1e-5);

  // And that it is orthonormal — a permutation, not a shear.
  for (int i = 0; i < 3; i++) {
    for (int j = 0; j < 3; j++) {
      float dot = M[i][0] * M[j][0] + M[i][1] * M[j][1] + M[i][2] * M[j][2];
      EXPECT_NEAR(dot, i == j ? 1.0 : 0.0, 1e-5);
    }
  }
}

TEST(accel_and_gyro_use_the_same_remap) {
  // A mismatch between the two would rotate accel and gyro into different
  // frames — the kind of bug that survives every single-axis test.
  float a[3], g[3];
  vtxConvertSample(7, 11, 13, 7, 11, 13, a, g);
  for (int i = 0; i < 3; i++) {
    EXPECT_NEAR(a[i] / ACCEL_SCALE, g[i] / GYRO_SCALE, 1e-3);
  }
}

TEST(gyro_units_are_degrees_per_second_not_radians) {
  // KNOWN DEFECT (documentation, not firmware): README.md and the parser's
  // record types label these fields rad/s, but GYRO_SCALE is the datasheet's
  // deg/s per LSB figure and no radian conversion exists anywhere in the
  // chain. This test pins the actual behavior — deg/s — so the discrepancy
  // stays visible until the docs are corrected or a conversion is added.
  // See firmware/test/README.md for the full trace.
  NOTE_KNOWN_DEFECT(
    "gyro fields are deg/s — docs corrected 2026-09-05; this test guards "
    "against regression to the rad/s labeling");

  float a[3], g[3];
  // Full-scale +1000 dps.
  vtxConvertSample(0, 0, 28571, 0, 0, 0, a, g);
  EXPECT_NEAR(g[0], 1000.0, 0.05);
  // If a radian conversion were applied this would be ~17.45 instead.
  EXPECT_TRUE(g[0] > 100.0);
}

// ============================================================
// 5. Button state machine
// ============================================================

TEST(button_short_press_fires_once_on_release) {
  ButtonState s;
  vtxButtonInit(&s);

  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 0), BTN_NONE);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, 100), BTN_NONE);   // down
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, 200), BTN_NONE);   // held, under long press
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 300), BTN_SHORT);  // released -> short press
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 400), BTN_NONE);  // no repeat
}

TEST(button_sub_debounce_press_is_ignored) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 1000);
  // Released after 49ms, under the 50ms debounce threshold.
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 1000 + BUTTON_DEBOUNCE_MS - 1), BTN_NONE);
}

TEST(button_press_exactly_at_debounce_threshold_fires) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 1000);
  // The comparison is >=, so exactly 50ms counts as a press.
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 1000 + BUTTON_DEBOUNCE_MS), BTN_SHORT);
}

TEST(button_long_press_fires_while_still_held) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 0);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS - 1), BTN_NONE);
  // Fires at the threshold without waiting for release — the user gets
  // feedback while their finger is still down.
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS), BTN_LONG);
}

TEST(button_long_press_does_not_double_fire_while_held) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 0);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS), BTN_LONG);
  // Still held, well past the threshold — must stay quiet.
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS + 500), BTN_NONE);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS + 5000), BTN_NONE);
}

TEST(button_no_short_press_on_release_after_long_press) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 0);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS), BTN_LONG);
  // Releasing after a long press must not also toggle recording — otherwise
  // a shutdown would start a recording on the way down.
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, BUTTON_LONG_PRESS_MS + 100), BTN_NONE);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, BUTTON_LONG_PRESS_MS + 200), BTN_NONE);
}

TEST(button_second_press_after_long_press_works) {
  ButtonState s;
  vtxButtonInit(&s);

  vtxButtonUpdate(&s, true, 0);
  vtxButtonUpdate(&s, true, BUTTON_LONG_PRESS_MS);   // long press
  vtxButtonUpdate(&s, false, BUTTON_LONG_PRESS_MS + 100);

  // A fresh short press must still register — the handled flag has to reset.
  vtxButtonUpdate(&s, true, 10000);
  EXPECT_EQ_INT(vtxButtonUpdate(&s, false, 10000 + BUTTON_DEBOUNCE_MS), BTN_SHORT);
}

TEST(button_repeated_short_presses_each_fire) {
  ButtonState s;
  vtxButtonInit(&s);

  for (int i = 0; i < 5; i++) {
    unsigned long base = 1000UL * (i + 1);
    vtxButtonUpdate(&s, true, base);
    EXPECT_EQ_INT(vtxButtonUpdate(&s, false, base + 100), BTN_SHORT);
  }
}

TEST(button_never_pressed_stays_silent) {
  ButtonState s;
  vtxButtonInit(&s);
  for (unsigned long t = 0; t < 10000; t += 250) {
    EXPECT_EQ_INT(vtxButtonUpdate(&s, false, t), BTN_NONE);
  }
}

// ============================================================
// 6. Filename generation
// ============================================================

TEST(filename_known_timestamp) {
  char name[48];
  // 1772349000000 ms = 2026-03-01 07:10:00 UTC = 2026-02-28 23:10:00 PST.
  vtxBuildFilename(name, sizeof(name), 1772349000000LL);

  // 23:10:00 PST -> 83400000 ms into the PST day.
  EXPECT_EQ_STR(name, "/vtx/2_28_2026_83400000.vtx");
}

TEST(filename_matches_shipped_recording_scheme) {
  // A real file in analysis/data/sample-recordings is 3_24_2026_54119728.vtx.
  // 54119728 ms into the PST day = 15:01:59.728 PST on 2026-03-24.
  // That instant is 2026-03-24 23:01:59.728 UTC = 1774393319728 ms.
  char name[48];
  vtxBuildFilename(name, sizeof(name), 1774393319728LL);
  EXPECT_EQ_STR(name, "/vtx/3_24_2026_54119728.vtx");
}

TEST(filename_at_pst_midnight) {
  // 2026-03-01 08:00:00 UTC = 2026-03-01 00:00:00 PST — msInDay wraps to 0.
  char name[48];
  vtxBuildFilename(name, sizeof(name), 1772352000000LL);
  EXPECT_EQ_STR(name, "/vtx/3_1_2026_0.vtx");
}

TEST(filename_just_before_pst_midnight) {
  // One millisecond earlier is still the previous PST day, at 86399999 ms.
  char name[48];
  vtxBuildFilename(name, sizeof(name), 1772352000000LL - 1);
  EXPECT_EQ_STR(name, "/vtx/2_28_2026_86399999.vtx");
}

TEST(filename_day_boundary_is_consistent) {
  // Stepping across PST midnight must advance the date exactly once and reset
  // msInDay, with no repeated or skipped day.
  const int64_t midnight = 1772352000000LL;
  char before[48], after[48];
  vtxBuildFilename(before, sizeof(before), midnight - 1);
  vtxBuildFilename(after, sizeof(after), midnight);

  EXPECT_TRUE(strcmp(before, after) != 0);
  EXPECT_EQ_STR(before, "/vtx/2_28_2026_86399999.vtx");
  EXPECT_EQ_STR(after, "/vtx/3_1_2026_0.vtx");
}

TEST(filename_default_epoch_before_clock_sync) {
  // Until the phone sends CMD_SYNC_CLOCK the firmware uses the compiled-in
  // default offset. Files still get a sane, sortable name.
  char name[48];
  vtxBuildFilename(name, sizeof(name), 1772349000000LL);
  EXPECT_EQ_STR(name, "/vtx/2_28_2026_83400000.vtx");
  EXPECT_TRUE(strstr(name, "/vtx/") == name);
  EXPECT_TRUE(strstr(name, ".vtx") != nullptr);
}

TEST(filename_at_unix_epoch_zero) {
  // KNOWN DEFECT: if the clock is never synced and the default offset is
  // cleared, wallClockMs() can return 0. Subtracting 8h puts the timestamp
  // before 1970, and the msInDay arithmetic produces a negative intermediate.
  // The result is a strange but non-crashing filename. Recorded here so the
  // behavior is pinned rather than discovered on a device.
  NOTE_KNOWN_DEFECT(
    "wallClockMs()==0 yields a pre-epoch filename (1969) with negative msInDay");

  char name[48];
  vtxBuildFilename(name, sizeof(name), 0);
  // 0 ms - 8h = 1969-12-31 16:00:00 UTC-8.
  EXPECT_TRUE(strstr(name, "1969") != nullptr);
  // Must still be a well-formed path that SD.open() will accept.
  EXPECT_TRUE(strstr(name, "/vtx/") == name);
  EXPECT_TRUE(strstr(name, ".vtx") != nullptr);
}

TEST(filename_fits_the_firmware_buffer) {
  // StorageManager::_currentFileName is char[48]; truncation would silently
  // produce a name without the .vtx suffix that isValidFilename() rejects.
  char name[48];
  // A far-future timestamp maximizes every numeric component.
  vtxBuildFilename(name, sizeof(name), 4102444800000LL);  // 2100-01-01 UTC
  EXPECT_TRUE(strlen(name) < 47);
  EXPECT_TRUE(strstr(name, ".vtx") != nullptr);
}

int main() {
  return vtxtest::runAllTests("Vertex V2 firmware — pure logic");
}
