/**
 * VTX Binary Format Encoder
 * Writes IMU data to .vtx binary files
 */

import {
  VTXHeader,
  VTXMetadata,
  IMURecord,
  GPSRecord,
  VTXEncoderOptions,
  VTX_CONSTANTS,
  RecordFormatFlags,
} from './types';

export class VTXEncoder {
  private sampleRate: number;
  private includeMag: boolean;
  private includeQuat: boolean;
  private includeGPS: boolean;
  private metadata: VTXMetadata;
  private records: IMURecord[] = [];
  private gpsRecords: GPSRecord[] = [];
  private recordSize: number;
  private recordFormat: number;

  constructor(options: VTXEncoderOptions) {
    this.sampleRate = options.sampleRate;
    this.includeMag = options.includeMag ?? false;
    this.includeQuat = options.includeQuat ?? false;
    this.includeGPS = options.includeGPS ?? false;
    this.metadata = options.metadata ?? {};

    // Calculate record format bitmask
    this.recordFormat =
      RecordFormatFlags.HAS_ACCEL | RecordFormatFlags.HAS_GYRO;
    if (this.includeMag) {
      this.recordFormat |= RecordFormatFlags.HAS_MAG;
    }
    if (this.includeQuat) {
      this.recordFormat |= RecordFormatFlags.HAS_QUAT;
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
    return size;
  }

  /**
   * Add a single IMU record to the encoder buffer
   */
  addRecord(record: IMURecord): void {
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

    this.records.push(record);
  }

  /**
   * Add multiple IMU records at once
   */
  addRecords(records: IMURecord[]): void {
    for (const record of records) {
      this.addRecord(record);
    }
  }

  /**
   * Add a single GPS record to the encoder buffer
   */
  addGPSRecord(record: GPSRecord): void {
    if (!this.includeGPS) {
      throw new Error('GPS recording is not enabled in encoder options');
    }

    // Validate required fields
    if (
      record.timestamp === undefined ||
      record.latitude === undefined ||
      record.longitude === undefined
    ) {
      throw new Error('GPS record missing required timestamp, latitude, or longitude');
    }

    this.gpsRecords.push(record);
  }

  /**
   * Add multiple GPS records at once
   */
  addGPSRecords(records: GPSRecord[]): void {
    for (const record of records) {
      this.addGPSRecord(record);
    }
  }

  /**
   * Encode all data to a binary buffer
   */
  encode(): ArrayBuffer {
    if (this.records.length === 0) {
      throw new Error('No records to encode');
    }

    // Sort records by timestamp to ensure proper ordering
    this.records.sort((a, b) => a.timestamp - b.timestamp);

    const startTimestamp = BigInt(this.records[0].timestamp);
    const endTimestamp = BigInt(this.records[this.records.length - 1].timestamp);

    // Serialize metadata to JSON
    const metadataJson = JSON.stringify(this.metadata);
    const metadataBytes = new TextEncoder().encode(metadataJson);
    const metadataLength = metadataBytes.length;

    // Calculate offsets
    const dataOffset = VTX_CONSTANTS.HEADER_SIZE + metadataLength;
    const imuDataSize = this.recordSize * this.records.length;

    // GPS data follows IMU data (if enabled)
    let gpsDataOffset = 0;
    let gpsDataSize = 0;
    if (this.includeGPS && this.gpsRecords.length > 0) {
      // Sort GPS records by timestamp
      this.gpsRecords.sort((a, b) => a.timestamp - b.timestamp);
      gpsDataOffset = dataOffset + imuDataSize;
      gpsDataSize = VTX_CONSTANTS.GPS_RECORD_SIZE * this.gpsRecords.length;
    }

    const totalSize = dataOffset + imuDataSize + gpsDataSize;

    // Create buffer for entire file
    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // Write header (64 bytes)
    const header: VTXHeader = {
      magic: VTX_CONSTANTS.MAGIC,
      versionMajor: VTX_CONSTANTS.VERSION_MAJOR,
      versionMinor: VTX_CONSTANTS.VERSION_MINOR,
      metadataLength,
      dataOffset,
      recordCount: BigInt(this.records.length),
      sampleRate: this.sampleRate,
      startTimestamp,
      endTimestamp,
      recordFormat: this.recordFormat,
      compression: VTX_CONSTANTS.COMPRESSION_NONE,
      gpsRecordCount: this.includeGPS ? BigInt(this.gpsRecords.length) : undefined,
      gpsDataOffset: this.includeGPS && this.gpsRecords.length > 0 ? gpsDataOffset : undefined,
    };

    offset = this.writeHeader(view, offset, header);

    // Write metadata
    offset = this.writeMetadata(buffer, offset, metadataBytes);

    // Write IMU data records
    offset = this.writeRecords(view, offset, startTimestamp);

    // Write GPS data records (if enabled)
    if (this.includeGPS && this.gpsRecords.length > 0) {
      offset = this.writeGPSRecords(view, offset, startTimestamp);
    }

    return buffer;
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

    // GPS record count (8 bytes, v1.1+)
    if (header.gpsRecordCount !== undefined) {
      view.setBigUint64(offset, header.gpsRecordCount, true);
    } else {
      view.setBigUint64(offset, BigInt(0), true);
    }
    offset += 8;

    // GPS data offset (4 bytes, v1.1+)
    if (header.gpsDataOffset !== undefined) {
      view.setUint32(offset, header.gpsDataOffset, true);
    } else {
      view.setUint32(offset, 0, true);
    }
    offset += 4;

    // Reserved fields (6 bytes remaining) - fill with zeros
    for (let i = 0; i < 6; i++) {
      view.setUint8(offset++, 0);
    }

    return offset;
  }

  /**
   * Write metadata JSON to buffer
   */
  private writeMetadata(
    buffer: ArrayBuffer,
    offset: number,
    metadataBytes: Uint8Array
  ): number {
    const uint8View = new Uint8Array(buffer);
    uint8View.set(metadataBytes, offset);
    return offset + metadataBytes.length;
  }

  /**
   * Write all data records to buffer
   */
  private writeRecords(
    view: DataView,
    offset: number,
    startTimestamp: bigint
  ): number {
    for (const record of this.records) {
      offset = this.writeRecord(view, offset, record, startTimestamp);
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

    return offset;
  }

  /**
   * Write all GPS records to buffer
   */
  private writeGPSRecords(
    view: DataView,
    offset: number,
    startTimestamp: bigint
  ): number {
    for (const record of this.gpsRecords) {
      offset = this.writeGPSRecord(view, offset, record, startTimestamp);
    }
    return offset;
  }

  /**
   * Write a single GPS record to buffer (44 bytes)
   */
  private writeGPSRecord(
    view: DataView,
    offset: number,
    record: GPSRecord,
    startTimestamp: bigint
  ): number {
    // Timestamp as offset from start (uint32 milliseconds)
    const timestampOffset = Number(BigInt(record.timestamp) - startTimestamp);
    view.setUint32(offset, timestampOffset, true);
    offset += 4;

    // Latitude (float64)
    view.setFloat64(offset, record.latitude, true);
    offset += 8;

    // Longitude (float64)
    view.setFloat64(offset, record.longitude, true);
    offset += 8;

    // Altitude (float32, or NaN if null)
    view.setFloat32(offset, record.altitude ?? NaN, true);
    offset += 4;

    // Speed (float32, or NaN if null)
    view.setFloat32(offset, record.speed ?? NaN, true);
    offset += 4;

    // Bearing (float32, or NaN if null)
    view.setFloat32(offset, record.bearing ?? NaN, true);
    offset += 4;

    // Accuracy (float32, or NaN if null)
    view.setFloat32(offset, record.accuracy ?? NaN, true);
    offset += 4;

    // Reserved (4 bytes)
    view.setUint32(offset, 0, true);
    offset += 4;

    return offset;
  }

  /**
   * Get current IMU record count
   */
  getRecordCount(): number {
    return this.records.length;
  }

  /**
   * Get current GPS record count
   */
  getGPSRecordCount(): number {
    return this.gpsRecords.length;
  }

  /**
   * Clear all buffered records
   */
  clear(): void {
    this.records = [];
    this.gpsRecords = [];
  }
}
