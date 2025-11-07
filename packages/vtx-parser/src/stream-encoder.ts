/**
 * VTX Binary Format Streaming Encoder
 * Writes IMU data incrementally to avoid memory issues with long recordings
 */

import {
  VTXHeader,
  VTXMetadata,
  IMURecord,
  VTXEncoderOptions,
  VTX_CONSTANTS,
  RecordFormatFlags,
} from './types';

/**
 * Callback function to write chunks of data
 * Used to write header, metadata, and data records incrementally
 */
export type WriteCallback = (chunk: Uint8Array) => void | Promise<void>;

/**
 * Streaming VTX encoder that writes data incrementally
 * Avoids storing all records in memory - ideal for long recordings
 */
export class VTXStreamEncoder {
  private sampleRate: number;
  private includeMag: boolean;
  private includeQuat: boolean;
  private includeEuler: boolean;
  private metadata: VTXMetadata;
  private recordSize: number;
  private recordFormat: number;
  private writeCallback: WriteCallback;

  private recordCount: number = 0;
  private startTimestamp: bigint | null = null;
  private lastTimestamp: bigint | null = null;
  private headerWritten: boolean = false;
  private tempHeaderBuffer: ArrayBuffer | null = null;

  constructor(options: VTXEncoderOptions & { writeCallback: WriteCallback }) {
    this.sampleRate = options.sampleRate;
    this.includeMag = options.includeMag ?? false;
    this.includeQuat = options.includeQuat ?? false;
    this.includeEuler = options.includeEuler ?? false;
    this.metadata = options.metadata ?? {};
    this.writeCallback = options.writeCallback;

    // Calculate record format bitmask
    this.recordFormat =
      RecordFormatFlags.HAS_ACCEL | RecordFormatFlags.HAS_GYRO;
    if (this.includeMag) {
      this.recordFormat |= RecordFormatFlags.HAS_MAG;
    }
    if (this.includeQuat) {
      this.recordFormat |= RecordFormatFlags.HAS_QUAT;
    }
    if (this.includeEuler) {
      this.recordFormat |= RecordFormatFlags.HAS_EULER;
    }

    // Calculate record size based on enabled sensors
    this.recordSize = this.calculateRecordSize();
  }

  /**
   * Calculate record size based on enabled sensors
   */
  private calculateRecordSize(): number {
    let size = 4; // timestamp_ms (uint32)
    size += 24; // accel (3 * float32) + gyro (3 * float32)
    if (this.includeMag) {
      size += 12; // mag (3 * float32)
    }
    if (this.includeQuat) {
      size += 16; // quat (4 * float32)
    }
    if (this.includeEuler) {
      size += 12; // euler (3 * float32: roll, pitch, yaw)
    }
    return size;
  }

  /**
   * Initialize the encoder and write the header + metadata
   * Must be called before adding any records
   */
  async initialize(): Promise<void> {
    if (this.headerWritten) {
      throw new Error('Encoder already initialized');
    }

    // Serialize metadata to JSON
    const metadataJson = JSON.stringify(this.metadata);
    const metadataBytes = new TextEncoder().encode(metadataJson);
    const metadataLength = metadataBytes.length;

    // Calculate offsets
    const dataOffset = VTX_CONSTANTS.HEADER_SIZE + metadataLength;

    // Write temporary header (we'll update it with final values in finalize())
    const tempHeader: VTXHeader = {
      magic: VTX_CONSTANTS.MAGIC,
      versionMajor: VTX_CONSTANTS.VERSION_MAJOR,
      versionMinor: VTX_CONSTANTS.VERSION_MINOR,
      metadataLength,
      dataOffset,
      recordCount: BigInt(0), // Will be updated in finalize()
      sampleRate: this.sampleRate,
      startTimestamp: BigInt(0), // Will be updated with first record
      endTimestamp: BigInt(0), // Will be updated in finalize()
      recordFormat: this.recordFormat,
      compression: VTX_CONSTANTS.COMPRESSION_NONE,
    };

    // Allocate temp buffer for header (will be rewritten in finalize)
    this.tempHeaderBuffer = new ArrayBuffer(VTX_CONSTANTS.HEADER_SIZE);
    const view = new DataView(this.tempHeaderBuffer);
    this.writeHeader(view, 0, tempHeader);

    // Write header
    await this.writeCallback(new Uint8Array(this.tempHeaderBuffer));

    // Write metadata
    await this.writeCallback(metadataBytes);

    this.headerWritten = true;
  }

  /**
   * Add a single IMU record and write it immediately
   */
  async addRecord(record: IMURecord): Promise<void> {
    if (!this.headerWritten) {
      throw new Error('Must call initialize() before adding records');
    }

    // Validate required fields
    if (
      record.accelX === undefined ||
      record.accelY === undefined ||
      record.accelZ === undefined ||
      record.gyroX === undefined ||
      record.gyroY === undefined ||
      record.gyroZ === undefined
    ) {
      throw new Error('Record missing required accelerometer or gyroscope data');
    }

    // Validate optional fields if enabled
    if (this.includeMag) {
      if (
        record.magX === undefined ||
        record.magY === undefined ||
        record.magZ === undefined
      ) {
        throw new Error('Magnetometer data required but missing in record');
      }
    }

    if (this.includeQuat) {
      if (
        record.quatW === undefined ||
        record.quatX === undefined ||
        record.quatY === undefined ||
        record.quatZ === undefined
      ) {
        throw new Error('Quaternion data required but missing in record');
      }
    }

    if (this.includeEuler) {
      if (
        record.roll === undefined ||
        record.pitch === undefined ||
        record.yaw === undefined
      ) {
        throw new Error('Euler angle data required but missing in record');
      }
    }

    // Track timestamps
    const timestamp = BigInt(record.timestamp);
    if (this.startTimestamp === null) {
      this.startTimestamp = timestamp;
    }
    this.lastTimestamp = timestamp;

    // Write record immediately
    const recordBuffer = new ArrayBuffer(this.recordSize);
    const view = new DataView(recordBuffer);
    this.writeRecord(view, 0, record, this.startTimestamp);

    await this.writeCallback(new Uint8Array(recordBuffer));

    this.recordCount++;
  }

  /**
   * Add multiple IMU records in batch
   */
  async addRecords(records: IMURecord[]): Promise<void> {
    for (const record of records) {
      await this.addRecord(record);
    }
  }

  /**
   * Finalize the encoding
   * Returns the updated header that should be written to the beginning of the file
   */
  finalize(): Uint8Array {
    if (!this.headerWritten) {
      throw new Error('Must call initialize() before finalize()');
    }

    if (this.recordCount === 0) {
      throw new Error('No records written');
    }

    // Create final header with correct values
    const metadataJson = JSON.stringify(this.metadata);
    const metadataBytes = new TextEncoder().encode(metadataJson);
    const metadataLength = metadataBytes.length;
    const dataOffset = VTX_CONSTANTS.HEADER_SIZE + metadataLength;

    const finalHeader: VTXHeader = {
      magic: VTX_CONSTANTS.MAGIC,
      versionMajor: VTX_CONSTANTS.VERSION_MAJOR,
      versionMinor: VTX_CONSTANTS.VERSION_MINOR,
      metadataLength,
      dataOffset,
      recordCount: BigInt(this.recordCount),
      sampleRate: this.sampleRate,
      startTimestamp: this.startTimestamp!,
      endTimestamp: this.lastTimestamp!,
      recordFormat: this.recordFormat,
      compression: VTX_CONSTANTS.COMPRESSION_NONE,
    };

    // Write final header to buffer
    const headerBuffer = new ArrayBuffer(VTX_CONSTANTS.HEADER_SIZE);
    const view = new DataView(headerBuffer);
    this.writeHeader(view, 0, finalHeader);

    return new Uint8Array(headerBuffer);
  }

  /**
   * Write file header to buffer
   */
  private writeHeader(view: DataView, offset: number, header: VTXHeader): number {
    // Magic bytes "VTX\0" (4 bytes)
    const magicBytes = new TextEncoder().encode(header.magic);
    for (let i = 0; i < 4; i++) {
      view.setUint8(offset++, magicBytes[i] || 0);
    }

    // Version (2 + 2 = 4 bytes)
    view.setUint16(offset, header.versionMajor, true);
    offset += 2;
    view.setUint16(offset, header.versionMinor, true);
    offset += 2;

    // Metadata length (4 bytes)
    view.setUint32(offset, header.metadataLength, true);
    offset += 4;

    // Data offset (4 bytes)
    view.setUint32(offset, header.dataOffset, true);
    offset += 4;

    // Record count (8 bytes)
    view.setBigUint64(offset, header.recordCount, true);
    offset += 8;

    // Sample rate (4 bytes float32)
    view.setFloat32(offset, header.sampleRate, true);
    offset += 4;

    // Start timestamp (8 bytes)
    view.setBigInt64(offset, header.startTimestamp, true);
    offset += 8;

    // End timestamp (8 bytes)
    view.setBigInt64(offset, header.endTimestamp, true);
    offset += 8;

    // Record format (1 byte)
    view.setUint8(offset++, header.recordFormat);

    // Compression (1 byte)
    view.setUint8(offset++, header.compression);

    // Reserved fields (18 bytes) - fill with zeros
    for (let i = 0; i < 18; i++) {
      view.setUint8(offset++, 0);
    }

    return offset;
  }

  /**
   * Write a single data record to buffer
   */
  private writeRecord(
    view: DataView,
    offset: number,
    record: IMURecord,
    startTimestamp: bigint
  ): number {
    // Timestamp as offset from start (uint32 milliseconds)
    const timestampOffset = Number(BigInt(record.timestamp) - startTimestamp);
    view.setUint32(offset, timestampOffset, true);
    offset += 4;

    // Accelerometer (3 * float32)
    view.setFloat32(offset, record.accelX, true);
    offset += 4;
    view.setFloat32(offset, record.accelY, true);
    offset += 4;
    view.setFloat32(offset, record.accelZ, true);
    offset += 4;

    // Gyroscope (3 * float32)
    view.setFloat32(offset, record.gyroX, true);
    offset += 4;
    view.setFloat32(offset, record.gyroY, true);
    offset += 4;
    view.setFloat32(offset, record.gyroZ, true);
    offset += 4;

    // Magnetometer (3 * float32) - optional
    if (this.includeMag && record.magX !== undefined) {
      view.setFloat32(offset, record.magX, true);
      offset += 4;
      view.setFloat32(offset, record.magY!, true);
      offset += 4;
      view.setFloat32(offset, record.magZ!, true);
      offset += 4;
    }

    // Quaternion (4 * float32) - optional
    if (this.includeQuat && record.quatW !== undefined) {
      view.setFloat32(offset, record.quatW, true);
      offset += 4;
      view.setFloat32(offset, record.quatX!, true);
      offset += 4;
      view.setFloat32(offset, record.quatY!, true);
      offset += 4;
      view.setFloat32(offset, record.quatZ!, true);
      offset += 4;
    }

    // Euler angles (3 * float32) - optional
    if (this.includeEuler && record.roll !== undefined) {
      view.setFloat32(offset, record.roll, true);
      offset += 4;
      view.setFloat32(offset, record.pitch!, true);
      offset += 4;
      view.setFloat32(offset, record.yaw!, true);
      offset += 4;
    }

    return offset;
  }

  /**
   * Get current record count
   */
  getRecordCount(): number {
    return this.recordCount;
  }

  /**
   * Get start timestamp (null if no records written yet)
   */
  getStartTimestamp(): bigint | null {
    return this.startTimestamp;
  }

  /**
   * Get last timestamp (null if no records written yet)
   */
  getLastTimestamp(): bigint | null {
    return this.lastTimestamp;
  }
}
