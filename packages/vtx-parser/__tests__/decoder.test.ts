/**
 * Tests for VTXDecoder
 */

import { VTXEncoder, VTXDecoder, IMURecord } from '../src';

describe('VTXDecoder', () => {
  function createSampleFile(recordCount: number = 10): ArrayBuffer {
    const records: IMURecord[] = [];
    for (let i = 0; i < recordCount; i++) {
      records.push({
        timestamp: 1000 + i * 10,
        accelX: 0.1 + i * 0.01,
        accelY: 0.2 + i * 0.01,
        accelZ: 9.8 + i * 0.01,
        gyroX: 0.01 + i * 0.001,
        gyroY: 0.02 + i * 0.001,
        gyroZ: 0.03 + i * 0.001,
      });
    }

    const encoder = new VTXEncoder({
      sampleRate: 100,
      metadata: {
        device: {
          id: 'test-device',
          name: 'Test Device',
        },
        session: {
          createdAt: new Date().toISOString(),
        },
      },
    });

    encoder.addRecords(records);
    return encoder.encode();
  }

  test('should decode header correctly', () => {
    const buffer = createSampleFile(10);
    const decoder = new VTXDecoder(buffer);

    const header = decoder.readHeader();

    expect(header.magic).toBe('VTX\0');
    expect(header.versionMajor).toBe(1);
    expect(header.versionMinor).toBe(0);
    expect(header.recordCount).toBe(BigInt(10));
    expect(header.sampleRate).toBe(100);
    expect(header.compression).toBe(0);
  });

  test('should decode metadata correctly', () => {
    const buffer = createSampleFile(10);
    const decoder = new VTXDecoder(buffer);

    decoder.readHeader();
    const metadata = decoder.readMetadata();

    expect(metadata.device?.id).toBe('test-device');
    expect(metadata.device?.name).toBe('Test Device');
    expect(metadata.session).toBeDefined();
  });

  test('should decode full file correctly', () => {
    const buffer = createSampleFile(10);
    const decoder = new VTXDecoder(buffer);

    const vtxFile = decoder.decode();

    expect(vtxFile.header.recordCount).toBe(BigInt(10));
    expect(vtxFile.metadata.device?.id).toBe('test-device');
    expect(vtxFile.records.length).toBe(10);

    // Verify first record
    expect(vtxFile.records[0].timestamp).toBe(1000);
    expect(vtxFile.records[0].accelX).toBeCloseTo(0.1, 5);
    expect(vtxFile.records[0].accelY).toBeCloseTo(0.2, 5);

    // Verify last record
    expect(vtxFile.records[9].timestamp).toBe(1090);
    expect(vtxFile.records[9].accelX).toBeCloseTo(0.19, 5);
  });

  test('should handle files with magnetometer data', () => {
    const records: IMURecord[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: 1000 + i * 10,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
      magX: 10.5 + i,
      magY: 20.5 + i,
      magZ: 30.5 + i,
    }));

    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeMag: true,
    });

    encoder.addRecords(records);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.records[0].magX).toBeCloseTo(10.5, 5);
    expect(decoded.records[0].magY).toBeCloseTo(20.5, 5);
    expect(decoded.records[0].magZ).toBeCloseTo(30.5, 5);
    expect(decoded.records[4].magX).toBeCloseTo(14.5, 5);
  });

  test('should handle files with quaternion data', () => {
    const records: IMURecord[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: 1000 + i * 10,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
      quatW: 1.0,
      quatX: 0.0 + i * 0.01,
      quatY: 0.0 + i * 0.01,
      quatZ: 0.0 + i * 0.01,
    }));

    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeQuat: true,
    });

    encoder.addRecords(records);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.records[0].quatW).toBeCloseTo(1.0, 5);
    expect(decoded.records[0].quatX).toBeCloseTo(0.0, 5);
    expect(decoded.records[4].quatX).toBeCloseTo(0.04, 5);
  });

  test('should throw error for invalid magic bytes', () => {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);

    // Write invalid magic
    view.setUint8(0, 0x58); // 'X'
    view.setUint8(1, 0x58); // 'X'
    view.setUint8(2, 0x58); // 'X'
    view.setUint8(3, 0x00);

    const decoder = new VTXDecoder(buffer);

    expect(() => decoder.readHeader()).toThrow('Invalid VTX file');
  });

  test('should throw error for unsupported version', () => {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);

    // Write correct magic
    const magic = new TextEncoder().encode('VTX\0');
    magic.forEach((byte, i) => view.setUint8(i, byte));

    // Write unsupported version
    view.setUint16(4, 99, true); // Major version 99
    view.setUint16(6, 0, true);

    const decoder = new VTXDecoder(buffer);

    expect(() => decoder.readHeader()).toThrow('Unsupported VTX version');
  });

  test('should handle empty metadata', () => {
    const records: IMURecord[] = [{
      timestamp: 1000,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
    }];

    const encoder = new VTXEncoder({
      sampleRate: 100,
      metadata: {}, // Empty metadata
    });

    encoder.addRecords(records);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.metadata).toBeDefined();
    expect(decoded.metadata.device).toBeUndefined();
  });

  test('should decode timestamps correctly', () => {
    const startTimestamp = 1698765432000; // Some timestamp in ms
    const records: IMURecord[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: startTimestamp + i * 10,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
    }));

    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecords(records);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.header.startTimestamp).toBe(BigInt(startTimestamp));
    expect(decoded.header.endTimestamp).toBe(BigInt(startTimestamp + 40));
    expect(decoded.records[0].timestamp).toBe(startTimestamp);
    expect(decoded.records[4].timestamp).toBe(startTimestamp + 40);
  });

  test('should handle large files', () => {
    const buffer = createSampleFile(1000); // 1000 records
    const decoder = new VTXDecoder(buffer);

    const decoded = decoder.decode();

    expect(decoded.records.length).toBe(1000);
    expect(decoded.header.recordCount).toBe(BigInt(1000));
  });

  test('should preserve precision of floating point values', () => {
    const preciseValue = 1.23456789;
    const records: IMURecord[] = [{
      timestamp: 1000,
      accelX: preciseValue,
      accelY: preciseValue * 2,
      accelZ: preciseValue * 3,
      gyroX: preciseValue / 10,
      gyroY: preciseValue / 20,
      gyroZ: preciseValue / 30,
    }];

    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecords(records);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    // Float32 precision (~6-7 significant digits)
    expect(decoded.records[0].accelX).toBeCloseTo(preciseValue, 6);
    expect(decoded.records[0].accelY).toBeCloseTo(preciseValue * 2, 6);
    expect(decoded.records[0].accelZ).toBeCloseTo(preciseValue * 3, 6);
  });
});
