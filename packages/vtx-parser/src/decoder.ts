/**
 * VTX Binary Format Decoder
 * Reads IMU data from .vtx binary files
 */

import {
  VTXHeader,
  VTXMetadata,
  IMURecord,
  GPSRecord,
  VTXFile,
  VTXDecoderOptions,
  VTX_CONSTANTS,
  RecordFormatFlags,
} from './types';

/**
 * Decode UTF-8 bytes to string (with React Native compatibility)
 */
function decodeUtf8(bytes: Uint8Array): string {
  // Use TextDecoder if available (Node.js, browser)
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }

  // Fallback for React Native: manual UTF-8 decoding
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i++];

    // Single-byte character (ASCII)
    if (byte1 < 0x80) {
      result += String.fromCharCode(byte1);
    }
    // Two-byte character
    else if (byte1 < 0xe0) {
      const byte2 = bytes[i++];
      result += String.fromCharCode(((byte1 & 0x1f) << 6) | (byte2 & 0x3f));
    }
    // Three-byte character
    else if (byte1 < 0xf0) {
      const byte2 = bytes[i++];
      const byte3 = bytes[i++];
      result += String.fromCharCode(
        ((byte1 & 0x0f) << 12) | ((byte2 & 0x3f) << 6) | (byte3 & 0x3f)
      );
    }
    // Four-byte character (surrogate pairs)
    else {
      const byte2 = bytes[i++];
      const byte3 = bytes[i++];
      const byte4 = bytes[i++];
      let codePoint =
        ((byte1 & 0x07) << 18) |
        ((byte2 & 0x3f) << 12) |
        ((byte3 & 0x3f) << 6) |
        (byte4 & 0x3f);
      codePoint -= 0x10000;
      result += String.fromCharCode(
        0xd800 + (codePoint >> 10),
        0xdc00 + (codePoint & 0x3ff)
      );
    }
  }
  return result;
}

export class VTXDecoder {
  private buffer: ArrayBuffer;
  private view: DataView;
  private header: VTXHeader | null = null;
  private metadata: VTXMetadata | null = null;
  private recordSize: number = 0;

  constructor(buffer: ArrayBuffer) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
  }

  /**
   * Decode the entire VTX file
   */
  decode(options: VTXDecoderOptions = {}): VTXFile {
    // Parse header
    this.header = this.readHeader();

    // Parse metadata (unless skipped)
    if (!options.skipMetadata) {
      this.metadata = this.readMetadata();
    } else {
      this.metadata = {};
    }

    // Return early if header only
    if (options.headerOnly) {
      return {
        header: this.header,
        metadata: this.metadata,
        records: [],
      };
    }

    // Parse data records
    let recordCount: number;

    if (options.recoveryMode) {
      // Recovery mode: calculate actual record count from file size
      // Don't trust header.recordCount (may be wrong in corrupted files)
      this.recordSize = this.calculateRecordSize(this.header.recordFormat);
      const dataSize = this.buffer.byteLength - Number(this.header.dataOffset);
      const actualRecordCount = Math.floor(dataSize / this.recordSize);

      console.log('[VTXDecoder] Recovery mode: scanning for actual records');
      console.log('[VTXDecoder] Data size:', dataSize, 'bytes');
      console.log('[VTXDecoder] Record size:', this.recordSize, 'bytes');
      console.log('[VTXDecoder] Calculated record count:', actualRecordCount);

      recordCount = options.maxRecords
        ? Math.min(options.maxRecords, actualRecordCount)
        : actualRecordCount;
    } else {
      // Normal mode: trust header
      const maxRecords = options.maxRecords ?? Number(this.header.recordCount);
      recordCount = Math.min(maxRecords, Number(this.header.recordCount));
    }

    const records = this.readRecords(0, recordCount);

    // Parse GPS records (if available in v1.1+)
    let gpsRecords: GPSRecord[] | undefined;
    if (this.header.gpsRecordCount && this.header.gpsRecordCount > 0n) {
      const gpsCount = Number(this.header.gpsRecordCount);
      const maxGPSRecords = options.maxRecords ?? gpsCount;
      const actualGPSCount = Math.min(maxGPSRecords, gpsCount);
      gpsRecords = this.readGPSRecords(0, actualGPSCount);
    }

    return {
      header: this.header,
      metadata: this.metadata,
      records,
      gpsRecords,
    };
  }

  /**
   * Read file header (64 bytes)
   */
  readHeader(): VTXHeader {
    if (this.buffer.byteLength < VTX_CONSTANTS.HEADER_SIZE) {
      throw new Error(
        `File too small: expected at least ${VTX_CONSTANTS.HEADER_SIZE} bytes, got ${this.buffer.byteLength}`
      );
    }

    let offset = 0;

    // Magic bytes "VTX\0" (4 bytes)
    const magicBytes = new Uint8Array(this.buffer, 0, 4);
    const magic = decodeUtf8(magicBytes);
    if (magic !== VTX_CONSTANTS.MAGIC) {
      throw new Error(
        `Invalid VTX file: expected magic "${VTX_CONSTANTS.MAGIC}", got "${magic}"`
      );
    }
    offset += 4;

    // Version (2 + 2 = 4 bytes)
    const versionMajor = this.view.getUint16(offset, true);
    offset += 2;
    const versionMinor = this.view.getUint16(offset, true);
    offset += 2;

    // Validate version
    if (versionMajor !== VTX_CONSTANTS.VERSION_MAJOR) {
      throw new Error(
        `Unsupported VTX version: ${versionMajor}.${versionMinor} (expected ${VTX_CONSTANTS.VERSION_MAJOR}.x)`
      );
    }

    // Metadata length (4 bytes)
    const metadataLength = this.view.getUint32(offset, true);
    offset += 4;

    // Data offset (4 bytes)
    const dataOffset = this.view.getUint32(offset, true);
    offset += 4;

    // Record count (8 bytes)
    const recordCount = this.view.getBigUint64(offset, true);
    offset += 8;

    // Sample rate (4 bytes float32)
    const sampleRate = this.view.getFloat32(offset, true);
    offset += 4;

    // Start timestamp (8 bytes)
    const startTimestamp = this.view.getBigInt64(offset, true);
    offset += 8;

    // End timestamp (8 bytes)
    const endTimestamp = this.view.getBigInt64(offset, true);
    offset += 8;

    // Record format (1 byte)
    const recordFormat = this.view.getUint8(offset++);

    // Compression (1 byte)
    const compression = this.view.getUint8(offset++);

    // Validate compression
    if (compression !== VTX_CONSTANTS.COMPRESSION_NONE) {
      throw new Error(
        `Unsupported compression type: ${compression} (only uncompressed files supported)`
      );
    }

    // Calculate record size based on format flags
    this.recordSize = this.calculateRecordSize(recordFormat);

    // GPS record count (8 bytes, v1.1+)
    let gpsRecordCount: bigint | undefined;
    let gpsDataOffset: number | undefined;

    if (versionMinor >= 1) {
      const gpsCount = this.view.getBigUint64(offset, true);
      offset += 8;

      const gpsOffset = this.view.getUint32(offset, true);
      offset += 4;

      // Only set if non-zero
      if (gpsCount > 0n) {
        gpsRecordCount = gpsCount;
        gpsDataOffset = gpsOffset;
      }

      // Skip remaining reserved fields (6 bytes)
      // offset += 6; // Not needed as we're done with header
    } else {
      // Skip all reserved fields (18 bytes) for v1.0
      // offset += 18; // Not needed as we're done with header
    }

    const header: VTXHeader = {
      magic,
      versionMajor,
      versionMinor,
      metadataLength,
      dataOffset,
      recordCount,
      sampleRate,
      startTimestamp,
      endTimestamp,
      recordFormat,
      compression,
      gpsRecordCount,
      gpsDataOffset,
    };

    this.header = header;
    return header;
  }

  /**
   * Calculate record size from format bitmask
   */
  private calculateRecordSize(recordFormat: number): number {
    let size = 4; // timestamp_ms (uint32)
    size += 24; // accel (3 * float32) + gyro (3 * float32)

    if (recordFormat & RecordFormatFlags.HAS_MAG) {
      size += 12; // mag (3 * float32)
    }

    if (recordFormat & RecordFormatFlags.HAS_QUAT) {
      size += 16; // quat (4 * float32)
    }

    if (recordFormat & RecordFormatFlags.HAS_EULER) {
      size += 12; // euler (3 * float32: roll, pitch, yaw)
    }

    return size;
  }

  /**
   * Read metadata JSON section
   */
  readMetadata(): VTXMetadata {
    if (!this.header) {
      throw new Error('Must read header before metadata');
    }

    if (this.header.metadataLength === 0) {
      return {};
    }

    const metadataStart = VTX_CONSTANTS.HEADER_SIZE;
    const metadataEnd = metadataStart + this.header.metadataLength;

    if (this.buffer.byteLength < metadataEnd) {
      throw new Error('File truncated: metadata section incomplete');
    }

    const metadataBytes = new Uint8Array(
      this.buffer,
      metadataStart,
      this.header.metadataLength
    );
    const metadataJson = decodeUtf8(metadataBytes);

    try {
      const metadata = JSON.parse(metadataJson) as VTXMetadata;
      this.metadata = metadata;
      return metadata;
    } catch (error) {
      throw new Error(`Invalid metadata JSON: ${error}`);
    }
  }

  /**
   * Read a range of data records
   */
  readRecords(startIndex: number, count: number): IMURecord[] {
    if (!this.header) {
      throw new Error('Must read header before records');
    }

    const totalRecords = Number(this.header.recordCount);
    if (startIndex < 0 || startIndex >= totalRecords) {
      throw new Error(
        `Invalid start index: ${startIndex} (file has ${totalRecords} records)`
      );
    }

    const actualCount = Math.min(count, totalRecords - startIndex);
    const records: IMURecord[] = [];

    for (let i = 0; i < actualCount; i++) {
      const record = this.readRecord(startIndex + i);
      records.push(record);
    }

    return records;
  }

  /**
   * Read a single data record by index
   */
  readRecord(index: number): IMURecord {
    if (!this.header) {
      throw new Error('Must read header before records');
    }

    const totalRecords = Number(this.header.recordCount);
    if (index < 0 || index >= totalRecords) {
      throw new Error(
        `Invalid record index: ${index} (file has ${totalRecords} records)`
      );
    }

    // Calculate byte offset for this record
    let offset = this.header.dataOffset + index * this.recordSize;

    if (this.buffer.byteLength < offset + this.recordSize) {
      throw new Error(`File truncated: record ${index} incomplete`);
    }

    // Read timestamp offset (uint32 milliseconds from start)
    const timestampOffset = this.view.getUint32(offset, true);
    offset += 4;

    // Calculate absolute timestamp
    const timestamp = Number(this.header.startTimestamp) + timestampOffset;

    // Read accelerometer (3 * float32)
    const accelX = this.view.getFloat32(offset, true);
    offset += 4;
    const accelY = this.view.getFloat32(offset, true);
    offset += 4;
    const accelZ = this.view.getFloat32(offset, true);
    offset += 4;

    // Read gyroscope (3 * float32)
    const gyroX = this.view.getFloat32(offset, true);
    offset += 4;
    const gyroY = this.view.getFloat32(offset, true);
    offset += 4;
    const gyroZ = this.view.getFloat32(offset, true);
    offset += 4;

    const record: IMURecord = {
      timestamp,
      accelX,
      accelY,
      accelZ,
      gyroX,
      gyroY,
      gyroZ,
    };

    // Read magnetometer (3 * float32) - optional
    if (this.header.recordFormat & RecordFormatFlags.HAS_MAG) {
      record.magX = this.view.getFloat32(offset, true);
      offset += 4;
      record.magY = this.view.getFloat32(offset, true);
      offset += 4;
      record.magZ = this.view.getFloat32(offset, true);
      offset += 4;
    }

    // Read quaternion (4 * float32) - optional
    if (this.header.recordFormat & RecordFormatFlags.HAS_QUAT) {
      record.quatW = this.view.getFloat32(offset, true);
      offset += 4;
      record.quatX = this.view.getFloat32(offset, true);
      offset += 4;
      record.quatY = this.view.getFloat32(offset, true);
      offset += 4;
      record.quatZ = this.view.getFloat32(offset, true);
      offset += 4;
    }

    // Read Euler angles (3 * float32) - optional
    if (this.header.recordFormat & RecordFormatFlags.HAS_EULER) {
      record.roll = this.view.getFloat32(offset, true);
      offset += 4;
      record.pitch = this.view.getFloat32(offset, true);
      offset += 4;
      record.yaw = this.view.getFloat32(offset, true);
      offset += 4;
    }

    return record;
  }

  /**
   * Read a range of GPS records
   */
  readGPSRecords(startIndex: number, count: number): GPSRecord[] {
    if (!this.header) {
      throw new Error('Must read header before GPS records');
    }

    if (!this.header.gpsRecordCount || !this.header.gpsDataOffset) {
      return [];
    }

    const totalGPSRecords = Number(this.header.gpsRecordCount);
    if (startIndex < 0 || startIndex >= totalGPSRecords) {
      throw new Error(
        `Invalid GPS start index: ${startIndex} (file has ${totalGPSRecords} GPS records)`
      );
    }

    const actualCount = Math.min(count, totalGPSRecords - startIndex);
    const gpsRecords: GPSRecord[] = [];

    for (let i = 0; i < actualCount; i++) {
      const record = this.readGPSRecord(startIndex + i);
      gpsRecords.push(record);
    }

    return gpsRecords;
  }

  /**
   * Read a single GPS record by index (44 bytes)
   */
  readGPSRecord(index: number): GPSRecord {
    if (!this.header) {
      throw new Error('Must read header before GPS records');
    }

    if (!this.header.gpsRecordCount || !this.header.gpsDataOffset) {
      throw new Error('No GPS data available in this file');
    }

    const totalGPSRecords = Number(this.header.gpsRecordCount);
    if (index < 0 || index >= totalGPSRecords) {
      throw new Error(
        `Invalid GPS record index: ${index} (file has ${totalGPSRecords} GPS records)`
      );
    }

    // Calculate byte offset for this GPS record
    let offset = this.header.gpsDataOffset + index * VTX_CONSTANTS.GPS_RECORD_SIZE;

    if (this.buffer.byteLength < offset + VTX_CONSTANTS.GPS_RECORD_SIZE) {
      throw new Error(`File truncated: GPS record ${index} incomplete`);
    }

    // Read timestamp offset (uint32 milliseconds from start)
    const timestampOffset = this.view.getUint32(offset, true);
    offset += 4;

    // Calculate absolute timestamp
    const timestamp = Number(this.header.startTimestamp) + timestampOffset;

    // Read latitude (float64)
    const latitude = this.view.getFloat64(offset, true);
    offset += 8;

    // Read longitude (float64)
    const longitude = this.view.getFloat64(offset, true);
    offset += 8;

    // Read altitude (float32, NaN means null)
    const altitudeRaw = this.view.getFloat32(offset, true);
    const altitude = isNaN(altitudeRaw) ? null : altitudeRaw;
    offset += 4;

    // Read speed (float32, NaN means null)
    const speedRaw = this.view.getFloat32(offset, true);
    const speed = isNaN(speedRaw) ? null : speedRaw;
    offset += 4;

    // Read bearing (float32, NaN means null)
    const bearingRaw = this.view.getFloat32(offset, true);
    const bearing = isNaN(bearingRaw) ? null : bearingRaw;
    offset += 4;

    // Read accuracy (float32, NaN means null)
    const accuracyRaw = this.view.getFloat32(offset, true);
    const accuracy = isNaN(accuracyRaw) ? null : accuracyRaw;
    offset += 4;

    // Skip reserved (4 bytes)
    // offset += 4; // Not needed

    return {
      timestamp,
      latitude,
      longitude,
      altitude,
      speed,
      bearing,
      accuracy,
    };
  }

  /**
   * Get header without reading entire file
   */
  getHeader(): VTXHeader {
    if (!this.header) {
      this.header = this.readHeader();
    }
    return this.header;
  }

  /**
   * Get metadata without reading records
   */
  getMetadata(): VTXMetadata {
    if (!this.header) {
      this.readHeader();
    }
    if (!this.metadata) {
      this.metadata = this.readMetadata();
    }
    return this.metadata;
  }

  /**
   * Get total record count
   */
  getRecordCount(): number {
    if (!this.header) {
      this.readHeader();
    }
    return Number(this.header!.recordCount);
  }

  /**
   * Get file duration in milliseconds
   */
  getDuration(): number {
    if (!this.header) {
      this.readHeader();
    }
    return Number(this.header!.endTimestamp - this.header!.startTimestamp);
  }

  /**
   * Get sample rate in Hz
   */
  getSampleRate(): number {
    if (!this.header) {
      this.readHeader();
    }
    return this.header!.sampleRate;
  }

  /**
   * Get total GPS record count
   */
  getGPSRecordCount(): number {
    if (!this.header) {
      this.readHeader();
    }
    return this.header!.gpsRecordCount ? Number(this.header!.gpsRecordCount) : 0;
  }
}

/**
 * Convenience function to decode a VTX file from ArrayBuffer
 */
export function decodeVTX(
  buffer: ArrayBuffer,
  options?: VTXDecoderOptions
): VTXFile {
  const decoder = new VTXDecoder(buffer);
  return decoder.decode(options);
}

/**
 * Convenience function to read just the header
 */
export function readVTXHeader(buffer: ArrayBuffer): VTXHeader {
  const decoder = new VTXDecoder(buffer);
  return decoder.readHeader();
}

/**
 * Convenience function to read header and metadata
 */
export function readVTXMetadata(buffer: ArrayBuffer): {
  header: VTXHeader;
  metadata: VTXMetadata;
} {
  const decoder = new VTXDecoder(buffer);
  const header = decoder.readHeader();
  const metadata = decoder.readMetadata();
  return { header, metadata };
}
