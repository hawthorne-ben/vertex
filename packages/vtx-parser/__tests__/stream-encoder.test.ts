/**
 * Tests for VTXStreamEncoder
 */

import { VTXStreamEncoder, VTXDecoder, IMURecord, WriteCallback } from '../src';

describe('VTXStreamEncoder', () => {
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

  function createBufferCollector(): { writeCallback: WriteCallback; getBuffer: () => ArrayBuffer } {
    const chunks: Uint8Array[] = [];

    return {
      writeCallback: (chunk: Uint8Array) => {
        chunks.push(new Uint8Array(chunk));
      },
      getBuffer: () => {
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const buffer = new ArrayBuffer(totalLength);
        const view = new Uint8Array(buffer);
        let offset = 0;
        for (const chunk of chunks) {
          view.set(chunk, offset);
          offset += chunk.length;
        }
        return buffer;
      },
    };
  }

  test('should create stream encoder with basic config', () => {
    const { writeCallback } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      includeMag: false,
      includeQuat: false,
      writeCallback,
    });

    expect(encoder).toBeDefined();
    expect(encoder.getRecordCount()).toBe(0);
  });

  test('should initialize and write header', async () => {
    const { writeCallback, getBuffer } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await encoder.initialize();

    const buffer = getBuffer();
    expect(buffer.byteLength).toBeGreaterThan(64); // Header + metadata
  });

  test('should throw error if not initialized', async () => {
    const { writeCallback } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await expect(encoder.addRecord(sampleRecords[0])).rejects.toThrow(
      'Must call initialize() before adding records'
    );
  });

  test('should write records incrementally', async () => {
    const { writeCallback, getBuffer } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await encoder.initialize();

    for (const record of sampleRecords) {
      await encoder.addRecord(record);
    }

    expect(encoder.getRecordCount()).toBe(3);
    expect(encoder.getStartTimestamp()).toBe(BigInt(1000));
    expect(encoder.getLastTimestamp()).toBe(BigInt(1020));
  });

  test('should encode and decode stream correctly', async () => {
    const { writeCallback, getBuffer } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      metadata: {
        device: {
          id: 'stream-test',
          name: 'Stream Test Device',
        },
      },
      writeCallback,
    });

    await encoder.initialize();

    for (const record of sampleRecords) {
      await encoder.addRecord(record);
    }

    // Finalize and update header
    const finalHeader = encoder.finalize();
    const buffer = getBuffer();

    // Replace header with final version
    const view = new Uint8Array(buffer);
    view.set(finalHeader, 0);

    // Decode and verify
    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.header.recordCount).toBe(BigInt(3));
    expect(decoded.header.sampleRate).toBe(100);
    expect(decoded.records.length).toBe(3);
    expect(decoded.metadata.device?.id).toBe('stream-test');

    // Verify first record
    expect(decoded.records[0].accelX).toBeCloseTo(0.1, 5);
    expect(decoded.records[0].accelY).toBeCloseTo(0.2, 5);
    expect(decoded.records[0].accelZ).toBeCloseTo(9.8, 5);
  });

  test('should handle magnetometer data in streaming', async () => {
    const recordsWithMag: IMURecord[] = sampleRecords.map(r => ({
      ...r,
      magX: 10.5,
      magY: 20.5,
      magZ: 30.5,
    }));

    const { writeCallback, getBuffer } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      includeMag: true,
      writeCallback,
    });

    await encoder.initialize();

    for (const record of recordsWithMag) {
      await encoder.addRecord(record);
    }

    const finalHeader = encoder.finalize();
    const buffer = getBuffer();
    new Uint8Array(buffer).set(finalHeader, 0);

    const decoder = new VTXDecoder(buffer);
    const decoded = decoder.decode();

    expect(decoded.records[0].magX).toBeCloseTo(10.5, 5);
    expect(decoded.records[0].magY).toBeCloseTo(20.5, 5);
    expect(decoded.records[0].magZ).toBeCloseTo(30.5, 5);
  });

  test('should throw error when finalizing with no records', async () => {
    const { writeCallback } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await encoder.initialize();

    expect(() => encoder.finalize()).toThrow('No records written');
  });

  test('should track timestamps correctly', async () => {
    const { writeCallback } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await encoder.initialize();

    expect(encoder.getStartTimestamp()).toBeNull();
    expect(encoder.getLastTimestamp()).toBeNull();

    await encoder.addRecord(sampleRecords[0]);
    expect(encoder.getStartTimestamp()).toBe(BigInt(1000));
    expect(encoder.getLastTimestamp()).toBe(BigInt(1000));

    await encoder.addRecord(sampleRecords[1]);
    expect(encoder.getStartTimestamp()).toBe(BigInt(1000));
    expect(encoder.getLastTimestamp()).toBe(BigInt(1010));

    await encoder.addRecord(sampleRecords[2]);
    expect(encoder.getStartTimestamp()).toBe(BigInt(1000));
    expect(encoder.getLastTimestamp()).toBe(BigInt(1020));
  });

  test('should prevent double initialization', async () => {
    const { writeCallback } = createBufferCollector();
    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback,
    });

    await encoder.initialize();

    await expect(encoder.initialize()).rejects.toThrow('Encoder already initialized');
  });

  test('should use async write callbacks', async () => {
    let writeCount = 0;
    const asyncWriteCallback: WriteCallback = async (chunk: Uint8Array) => {
      await new Promise(resolve => setTimeout(resolve, 1));
      writeCount++;
    };

    const encoder = new VTXStreamEncoder({
      sampleRate: 100,
      writeCallback: asyncWriteCallback,
    });

    await encoder.initialize();
    expect(writeCount).toBeGreaterThan(0); // Header + metadata written

    const initialWrites = writeCount;
    await encoder.addRecord(sampleRecords[0]);
    expect(writeCount).toBe(initialWrites + 1); // One more write for record
  });
});
