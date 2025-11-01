/**
 * Tests for VTXEncoder
 */

import { VTXEncoder, VTXDecoder, IMURecord } from '../src';

describe('VTXEncoder', () => {
  const sampleRecords: IMURecord[] = [
    {
      timestamp: 1000,
      accelX: 0.1,
      accelY: 0.2,
      accelZ: 9.8,
      gyroX: 0.01,
      gyroY: 0.02,
      gyroZ: 0.03,
    },
    {
      timestamp: 1010,
      accelX: 0.15,
      accelY: 0.25,
      accelZ: 9.85,
      gyroX: 0.015,
      gyroY: 0.025,
      gyroZ: 0.035,
    },
    {
      timestamp: 1020,
      accelX: 0.12,
      accelY: 0.22,
      accelZ: 9.82,
      gyroX: 0.012,
      gyroY: 0.022,
      gyroZ: 0.032,
    },
  ];

  test('should create encoder with basic config', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeMag: false,
      includeQuat: false,
    });

    expect(encoder).toBeDefined();
    expect(encoder.getRecordCount()).toBe(0);
  });

  test('should add single record', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecord(sampleRecords[0]);
    expect(encoder.getRecordCount()).toBe(1);
  });

  test('should add multiple records', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecords(sampleRecords);
    expect(encoder.getRecordCount()).toBe(3);
  });

  test('should encode and decode records correctly', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
      metadata: {
        device: {
          id: 'test-device',
          name: 'Test Device',
        },
      },
    });

    encoder.addRecords(sampleRecords);
    const buffer = encoder.encode();

    expect(buffer).toBeInstanceOf(ArrayBuffer);
    expect(buffer.byteLength).toBeGreaterThan(64); // At least header size

    // Decode and verify
    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.header.recordCount).toBe(BigInt(3));
    expect(decoded.header.sampleRate).toBe(100);
    expect(decoded.records.length).toBe(3);
    expect(decoded.metadata.device?.id).toBe('test-device');

    // Verify first record
    expect(decoded.records[0].accelX).toBeCloseTo(0.1, 5);
    expect(decoded.records[0].accelY).toBeCloseTo(0.2, 5);
    expect(decoded.records[0].accelZ).toBeCloseTo(9.8, 5);
  });

  test('should include magnetometer data when enabled', () => {
    const recordsWithMag: IMURecord[] = sampleRecords.map(r => ({
      ...r,
      magX: 10.5,
      magY: 20.5,
      magZ: 30.5,
    }));

    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeMag: true,
    });

    encoder.addRecords(recordsWithMag);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.records[0].magX).toBeCloseTo(10.5, 5);
    expect(decoded.records[0].magY).toBeCloseTo(20.5, 5);
    expect(decoded.records[0].magZ).toBeCloseTo(30.5, 5);
  });

  test('should include quaternion data when enabled', () => {
    const recordsWithQuat: IMURecord[] = sampleRecords.map(r => ({
      ...r,
      quatW: 1.0,
      quatX: 0.0,
      quatY: 0.0,
      quatZ: 0.0,
    }));

    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeQuat: true,
    });

    encoder.addRecords(recordsWithQuat);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.records[0].quatW).toBeCloseTo(1.0, 5);
    expect(decoded.records[0].quatX).toBeCloseTo(0.0, 5);
  });

  test('should throw error when encoding with no records', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    expect(() => encoder.encode()).toThrow('No records to encode');
  });

  test('should throw error when missing required fields', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    const invalidRecord = {
      timestamp: 1000,
      accelX: 0.1,
      // Missing other required fields
    } as IMURecord;

    expect(() => encoder.addRecord(invalidRecord)).toThrow();
  });

  test('should throw error when mag enabled but data missing', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
      includeMag: true,
    });

    expect(() => encoder.addRecord(sampleRecords[0])).toThrow(
      'Magnetometer data required but missing in record'
    );
  });

  test('should sort records by timestamp', () => {
    const unsortedRecords: IMURecord[] = [
      { ...sampleRecords[2], timestamp: 1020 },
      { ...sampleRecords[0], timestamp: 1000 },
      { ...sampleRecords[1], timestamp: 1010 },
    ];

    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecords(unsortedRecords);
    const buffer = encoder.encode();

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    // Should be sorted by timestamp
    expect(decoded.records[0].timestamp).toBe(1000);
    expect(decoded.records[1].timestamp).toBe(1010);
    expect(decoded.records[2].timestamp).toBe(1020);
  });

  test('should clear records', () => {
    const encoder = new VTXEncoder({
      sampleRate: 100,
    });

    encoder.addRecords(sampleRecords);
    expect(encoder.getRecordCount()).toBe(3);

    encoder.clear();
    expect(encoder.getRecordCount()).toBe(0);
  });
});
