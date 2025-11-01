/**
 * VTXFileService - Service for VTX binary file operations
 * Handles reading and writing .vtx files for IMU sensor data
 */

import RNFS from 'react-native-fs';
import {
  VTXEncoder,
  VTXDecoder,
  IMURecord,
  VTXMetadata,
  VTXFile,
  VTXHeader,
} from '@vertex-pkg/vtx-parser';

export interface VTXRecordingMetadata {
  fileName: string;
  filePath: string;
  startTime: Date;
  endTime: Date;
  sampleCount: number;
  fileSize: number;
  sampleRate: number;
  deviceName?: string;
  deviceId?: string;
  includeMag: boolean;
  includeQuat: boolean;
}

class VTXFileService {
  private static instance: VTXFileService;

  private constructor() {}

  static getInstance(): VTXFileService {
    if (!VTXFileService.instance) {
      VTXFileService.instance = new VTXFileService();
    }
    return VTXFileService.instance;
  }

  /**
   * Get the directory path for storing VTX recordings
   */
  private getRecordingsDirectory(): string {
    return RNFS.DocumentDirectoryPath;
  }

  /**
   * Create a new VTX recording file
   * Returns the file path for the new recording
   */
  async createRecordingFile(
    deviceName: string,
    sampleRate: number,
    metadata: VTXMetadata = {}
  ): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .split('.')[0];
    const fileName = `${deviceName}_imu_${timestamp}.vtx`;
    const filePath = `${this.getRecordingsDirectory()}/${fileName}`;

    // Store encoder options for this file
    // We'll actually write the file when appendIMUData is called
    return filePath;
  }

  /**
   * Write VTX file from IMU records array
   */
  async writeVTXFile(
    filePath: string,
    records: IMURecord[],
    sampleRate: number,
    metadata: VTXMetadata = {},
    options: {
      includeMag?: boolean;
      includeQuat?: boolean;
    } = {}
  ): Promise<void> {
    // Create encoder
    const encoder = new VTXEncoder({
      sampleRate,
      includeMag: options.includeMag ?? false,
      includeQuat: options.includeQuat ?? false,
      metadata,
    });

    // Add all records
    encoder.addRecords(records);

    // Encode to binary
    const buffer = encoder.encode();

    // Convert ArrayBuffer to base64 for React Native FS
    const uint8Array = new Uint8Array(buffer);
    const base64 = this.arrayBufferToBase64(uint8Array);

    // Write to file
    await RNFS.writeFile(filePath, base64, 'base64');
  }

  /**
   * Read VTX file and parse it
   */
  async readVTXFile(filePath: string): Promise<VTXFile> {
    // Read file as base64
    const base64 = await RNFS.readFile(filePath, 'base64');

    // Convert base64 to ArrayBuffer
    const buffer = this.base64ToArrayBuffer(base64);

    // Decode VTX file
    const decoder = new VTXDecoder(buffer);
    return decoder.decode();
  }

  /**
   * Read only VTX file header (fast preview)
   */
  async readVTXHeader(filePath: string): Promise<VTXHeader> {
    // Read first 64 bytes only
    const base64 = await RNFS.read(filePath, 64, 0, 'base64');
    const buffer = this.base64ToArrayBuffer(base64);

    const decoder = new VTXDecoder(buffer);
    return decoder.readHeader();
  }

  /**
   * Read VTX file metadata without loading all records
   */
  async readVTXMetadata(
    filePath: string
  ): Promise<{ header: VTXHeader; metadata: VTXMetadata }> {
    // Need to read header + metadata section
    // First read header to get metadata length
    const headerBase64 = await RNFS.read(filePath, 64, 0, 'base64');
    const headerBuffer = this.base64ToArrayBuffer(headerBase64);
    const tempDecoder = new VTXDecoder(headerBuffer);
    const header = tempDecoder.readHeader();

    // Now read header + metadata
    const totalBytes = 64 + header.metadataLength;
    const fullBase64 = await RNFS.read(filePath, totalBytes, 0, 'base64');
    const fullBuffer = this.base64ToArrayBuffer(fullBase64);

    const decoder = new VTXDecoder(fullBuffer);
    const fullHeader = decoder.readHeader();
    const metadata = decoder.readMetadata();

    return { header: fullHeader, metadata };
  }

  /**
   * Get list of all VTX recordings with metadata
   */
  async getRecordings(): Promise<VTXRecordingMetadata[]> {
    const directory = this.getRecordingsDirectory();
    const files = await RNFS.readDir(directory);

    const vtxFiles = files.filter((file) => file.name.endsWith('.vtx'));

    const recordings: VTXRecordingMetadata[] = [];

    for (const file of vtxFiles) {
      try {
        const { header, metadata } = await this.readVTXMetadata(file.path);

        const recordingMetadata: VTXRecordingMetadata = {
          fileName: file.name,
          filePath: file.path,
          startTime: new Date(Number(header.startTimestamp)),
          endTime: new Date(Number(header.endTimestamp)),
          sampleCount: Number(header.recordCount),
          fileSize: parseInt(file.size),
          sampleRate: header.sampleRate,
          deviceName: metadata.device?.name,
          deviceId: metadata.device?.id,
          includeMag: !!(header.recordFormat & 0x04), // HAS_MAG flag
          includeQuat: !!(header.recordFormat & 0x08), // HAS_QUAT flag
        };

        recordings.push(recordingMetadata);
      } catch (error) {
        console.error(`Error reading VTX metadata from ${file.name}:`, error);
      }
    }

    // Sort by newest first
    return recordings.sort(
      (a, b) => b.startTime.getTime() - a.startTime.getTime()
    );
  }

  /**
   * Get file information without reading all data
   */
  async getFileInfo(
    filePath: string
  ): Promise<{
    fileSize: number;
    sampleCount: number;
    duration: number;
    sampleRate: number;
  }> {
    const stat = await RNFS.stat(filePath);
    const { header } = await this.readVTXMetadata(filePath);

    return {
      fileSize: parseInt(stat.size),
      sampleCount: Number(header.recordCount),
      duration: Number(header.endTimestamp - header.startTimestamp),
      sampleRate: header.sampleRate,
    };
  }

  /**
   * Delete a VTX recording file
   */
  async deleteRecording(filePath: string): Promise<void> {
    const exists = await RNFS.exists(filePath);
    if (exists) {
      await RNFS.unlink(filePath);
    }
  }

  /**
   * Check if a VTX file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    return await RNFS.exists(filePath);
  }

  /**
   * Read a subset of records from VTX file (for efficient data viewing)
   */
  async readRecords(
    filePath: string,
    startIndex: number,
    count: number
  ): Promise<IMURecord[]> {
    const vtxFile = await this.readVTXFile(filePath);
    return vtxFile.records.slice(startIndex, startIndex + count);
  }

  /**
   * Convert VTX file to CSV format (for backward compatibility)
   */
  async convertToCSV(
    vtxFilePath: string,
    csvFilePath?: string
  ): Promise<string> {
    const vtxFile = await this.readVTXFile(vtxFilePath);

    // Generate CSV file path if not provided
    const outputPath =
      csvFilePath ||
      vtxFilePath.replace('.vtx', '.csv').replace(/\.vtx$/, '_converted.csv');

    // Create CSV header
    let csv =
      'timestamp_ms,accel_x,accel_y,accel_z,gyro_x,gyro_y,gyro_z,mag_x,mag_y,mag_z,quat_w,quat_x,quat_y,quat_z\n';

    // Add data rows
    for (const record of vtxFile.records) {
      const row = [
        record.timestamp,
        record.accelX,
        record.accelY,
        record.accelZ,
        record.gyroX,
        record.gyroY,
        record.gyroZ,
        record.magX ?? '',
        record.magY ?? '',
        record.magZ ?? '',
        record.quatW ?? '',
        record.quatX ?? '',
        record.quatY ?? '',
        record.quatZ ?? '',
      ].join(',');
      csv += row + '\n';
    }

    // Write CSV file
    await RNFS.writeFile(outputPath, csv, 'utf8');

    return outputPath;
  }

  /**
   * Helper: Convert ArrayBuffer to base64 string
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  /**
   * Helper: Convert base64 string to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

export default VTXFileService.getInstance();
