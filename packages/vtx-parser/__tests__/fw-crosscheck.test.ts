/**
 * Cross-check against the firmware's write path.
 *
 * Builds a file byte-for-byte the way storage_manager.cpp writes it — packed
 * C struct layout, header patched at offsets 58 (uint32 offset) and 62
 * (uint16 count) — and confirms the TS decoder reads it, and that the drift
 * fit matches the Python parser's answer on identical bytes.
 *
 * This is the closest software check on the firmware layout short of running
 * the device.
 */
import { VTXDecoder, computeClockDrift } from '../src';

const HEADER_SIZE = 64;
const IMU_RECORD_SIZE = 28;
const SYNC_RECORD_SIZE = 24;

/** Mirrors StorageManager::writeVTXHeader + writeSyncSection */
function buildFirmwareShapedFile(): ArrayBuffer {
  const meta = new TextEncoder().encode(
    '{"device":{"name":"Vertex-V2","firmwareVersion":"2.0.0",' +
      '"hardwareRevision":"v2"},"session":{"position":"Seatpost"}}'
  );
  const imuCount = 100;
  const dataOffset = HEADER_SIZE + meta.length;
  const imuSize = imuCount * IMU_RECORD_SIZE;

  // 30ppm slow device, 40ms RTT, 60s cadence — same generator as the Python
  // cross-check, so both parsers see identical bytes.
  const d0 = 100000;
  const p0 = 1772349000000;
  const eps = 30e-6;
  const syncs: Array<[number, number, number, number]> = [];
  for (let i = 0; i < 5; i++) {
    const te = i * 60000;
    const t1 = Math.round(d0 + te * (1 - eps));
    const t2 = p0 + te + 20;
    const t4 = Math.round(t1 + 40 * (1 - eps));
    syncs.push([t1, t4, t2, t2]);
  }

  const syncOffset = dataOffset + imuSize;
  const total = syncOffset + syncs.length * SYNC_RECORD_SIZE;
  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  bytes.set([0x56, 0x54, 0x58, 0x00], 0); // "VTX\0"
  view.setUint16(4, 1, true); // VTX_FORMAT_MAJOR
  view.setUint16(6, 2, true); // VTX_FORMAT_MINOR
  view.setUint32(8, meta.length, true);
  view.setUint32(12, dataOffset, true);
  view.setBigUint64(16, BigInt(imuCount), true);
  view.setFloat32(24, 104.0, true);
  view.setBigInt64(28, BigInt(p0), true);
  view.setBigInt64(36, BigInt(p0 + 10000), true);
  view.setUint8(44, 0x03); // accel + gyro
  view.setUint8(45, 0); // no compression
  // 46-57 left zero: no GPS on device
  view.setUint32(58, syncOffset, true); // patched by writeSyncSection()
  view.setUint16(62, syncs.length, true);

  bytes.set(meta, HEADER_SIZE);

  let off = dataOffset;
  for (let i = 0; i < imuCount; i++) {
    view.setUint32(off, i * 10, true);
    view.setFloat32(off + 4, 0.1, true);
    view.setFloat32(off + 8, 0.2, true);
    view.setFloat32(off + 12, 9.81, true);
    view.setFloat32(off + 16, 0.01, true);
    view.setFloat32(off + 20, 0.02, true);
    view.setFloat32(off + 24, 0.03, true);
    off += IMU_RECORD_SIZE;
  }

  for (const [t1, t4, t2, t3] of syncs) {
    view.setUint32(off, t1, true);
    view.setUint32(off + 4, t4, true);
    view.setBigInt64(off + 8, BigInt(t2), true);
    view.setBigInt64(off + 16, BigInt(t3), true);
    off += SYNC_RECORD_SIZE;
  }

  return buffer;
}

describe('firmware write-path cross-check', () => {
  test('a firmware-shaped v1.2 file parses in the TS decoder', () => {
    const decoded = new VTXDecoder(buildFirmwareShapedFile()).decode();

    expect(decoded.header.versionMinor).toBe(2);
    expect(decoded.records).toHaveLength(100);
    expect(decoded.syncRecords).toHaveLength(5);
    expect(decoded.syncRecords![0]).toEqual({
      t1DeviceMs: 100000,
      t4DeviceMs: 100040,
      t2PhoneUnixMs: 1772349000020,
      t3PhoneUnixMs: 1772349000020,
    });
  });

  test('drift fit matches the Python parser on identical bytes', () => {
    const decoded = new VTXDecoder(buildFirmwareShapedFile()).decode();
    const fit = computeClockDrift(decoded.syncRecords!);

    // Python's compute_clock_drift() returns 28.334 ppm for these bytes.
    expect(fit.ppm).toBeCloseTo(28.334, 2);
  });

  test('five samples over four minutes is reported as untrustworthy', () => {
    // The injected rate is 30ppm but the fit returns 28.3: with ms-rounded
    // timestamps over a 4-minute span, quantization dominates. The point of
    // the quality metric is that a caller is told not to rely on this.
    const decoded = new VTXDecoder(buildFirmwareShapedFile()).decode();
    const fit = computeClockDrift(decoded.syncRecords!);

    expect(fit.trustworthy).toBe(false);
    expect(fit.warnings.some((w) => /short/.test(w))).toBe(true);
  });
});
