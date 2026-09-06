/*
 * Encode a .vtx file using the firmware's own serialization code.
 *
 * Writes to the path given as argv[1], then prints the values it encoded as
 * JSON on stdout. crosscheck.py decodes the file with packages/vtx-parser and
 * compares against that JSON, so the assertion is firmware-encode against
 * parser-decode rather than against a hand-written expectation.
 *
 * The write sequence mirrors StorageManager exactly: header with placeholders,
 * metadata, records, then patch record_count at 16 and end_timestamp at 36,
 * then append the sync section and patch offset 58 / count 62.
 */

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

#include "../imu_manager_v2/vtx_format.h"

struct __attribute__((packed)) IMURecord {
  uint32_t timestamp_ms;
  float accel_x, accel_y, accel_z;
  float gyro_x, gyro_y, gyro_z;
};

struct __attribute__((packed)) ClockSyncRecord {
  uint32_t t1_device_ms;
  uint32_t t4_device_ms;
  int64_t  t2_phone_unix_ms;
  int64_t  t3_phone_unix_ms;
};

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: gen_vtx_fixture <out.vtx>\n");
    return 2;
  }

  const int64_t startTs = 1772349000000LL;
  const int kRecords = 64;
  const int kSyncs = 3;

  // --- Synthesize raw FIFO samples and convert them the way readFIFO() does.
  // Values are chosen to be distinct per axis and to include negatives, so a
  // transposed or sign-flipped axis cannot survive the round trip.
  std::vector<IMURecord> records(kRecords);
  for (int i = 0; i < kRecords; i++) {
    int16_t gx = (int16_t)(100 + i);
    int16_t gy = (int16_t)(-200 - i);
    int16_t gz = (int16_t)(300 + 2 * i);
    int16_t ax = (int16_t)(1000 + i);
    int16_t ay = (int16_t)(4098 - i);   // ~1g on the gravity axis
    int16_t az = (int16_t)(-1500 - i);

    records[i].timestamp_ms = (uint32_t)(i * 1000 / IMU_ODR_HZ);
    vtxConvertSample(gx, gy, gz, ax, ay, az,
                     &records[i].accel_x, &records[i].gyro_x);
  }

  std::vector<ClockSyncRecord> syncs(kSyncs);
  for (int i = 0; i < kSyncs; i++) {
    syncs[i].t1_device_ms = (uint32_t)(100000 + i * 60000);
    syncs[i].t4_device_ms = (uint32_t)(100040 + i * 60000);
    syncs[i].t2_phone_unix_ms = startTs + i * 60000 + 20;
    syncs[i].t3_phone_unix_ms = startTs + i * 60000 + 25;
  }

  // --- Write exactly as StorageManager does.
  char metaJson[256];
  int metaLen = vtxBuildMetadata(metaJson, sizeof(metaJson));

  uint8_t header[VTX_HEADER_SIZE];
  vtxWriteHeader(header, (uint32_t)metaLen, startTs);

  FILE* f = fopen(argv[1], "wb+");
  if (!f) { perror("fopen"); return 1; }

  fwrite(header, 1, VTX_HEADER_SIZE, f);
  fwrite(metaJson, 1, (size_t)metaLen, f);
  fwrite(records.data(), sizeof(IMURecord), records.size(), f);

  // closeFile(): patchHeader() then writeSyncSection()
  const int64_t endTs = startTs + 10000;
  uint8_t buf[8];

  vtxPatchRecordCount(buf, (uint64_t)kRecords);
  fseek(f, VTX_OFF_RECORD_COUNT, SEEK_SET);
  fwrite(buf, 1, 8, f);

  vtxPatchEndTimestamp(buf, endTs);
  fseek(f, VTX_OFF_END_TIMESTAMP, SEEK_SET);
  fwrite(buf, 1, 8, f);

  fseek(f, 0, SEEK_END);
  uint32_t syncOffset = (uint32_t)ftell(f);
  fwrite(syncs.data(), sizeof(ClockSyncRecord), syncs.size(), f);

  vtxPutU32(buf, syncOffset);
  fseek(f, VTX_OFF_SYNC_DATA_OFFSET, SEEK_SET);
  fwrite(buf, 1, 4, f);

  uint16_t syncCount = (uint16_t)kSyncs;
  vtxPutU16(buf, syncCount);
  fseek(f, VTX_OFF_SYNC_RECORD_COUNT, SEEK_SET);
  fwrite(buf, 1, 2, f);

  fclose(f);

  // --- Report what was encoded, for the decoder to be checked against.
  printf("{\n");
  printf("  \"version_major\": %d,\n", VTX_FORMAT_MAJOR);
  printf("  \"version_minor\": %d,\n", VTX_FORMAT_MINOR);
  printf("  \"metadata_length\": %d,\n", metaLen);
  printf("  \"data_offset\": %d,\n", VTX_HEADER_SIZE + metaLen);
  printf("  \"record_count\": %d,\n", kRecords);
  printf("  \"sample_rate\": %d,\n", IMU_ODR_HZ);
  printf("  \"start_timestamp\": %lld,\n", (long long)startTs);
  printf("  \"end_timestamp\": %lld,\n", (long long)endTs);
  printf("  \"record_format\": %d,\n", VTX_RECORD_FORMAT);
  printf("  \"compression\": %d,\n", VTX_COMPRESSION_NONE);
  printf("  \"sync_data_offset\": %u,\n", syncOffset);
  printf("  \"sync_record_count\": %d,\n", kSyncs);

  printf("  \"records\": [\n");
  for (int i = 0; i < kRecords; i++) {
    const IMURecord& r = records[i];
    printf("    [%u, %.9g, %.9g, %.9g, %.9g, %.9g, %.9g]%s\n",
           r.timestamp_ms, r.accel_x, r.accel_y, r.accel_z,
           r.gyro_x, r.gyro_y, r.gyro_z, i + 1 < kRecords ? "," : "");
  }
  printf("  ],\n");

  printf("  \"sync_records\": [\n");
  for (int i = 0; i < kSyncs; i++) {
    const ClockSyncRecord& s = syncs[i];
    printf("    [%u, %u, %lld, %lld]%s\n",
           s.t1_device_ms, s.t4_device_ms,
           (long long)s.t2_phone_unix_ms, (long long)s.t3_phone_unix_ms,
           i + 1 < kSyncs ? "," : "");
  }
  printf("  ]\n");
  printf("}\n");

  return 0;
}
