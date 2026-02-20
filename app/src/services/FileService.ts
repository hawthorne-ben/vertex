/**
 * File Service
 *
 * Handles listing and managing VTX recording files.
 */

import RNFS from 'react-native-fs';
import VTXFileService from './VTXFileService';

export interface IMUSensorData {
  timestamp: Date;
  accel_x: number;
  accel_y: number;
  accel_z: number;
  gyro_x: number;
  gyro_y: number;
  gyro_z: number;
  mag_x?: number;
  mag_y?: number;
  mag_z?: number;
  quat_w?: number;
  quat_x?: number;
  quat_y?: number;
  quat_z?: number;
  roll?: number;
  pitch?: number;
  yaw?: number;
}

export interface RecordingMetadata {
  fileName: string;
  filePath: string;
  startTime: Date;
  endTime?: Date;
  sampleCount: number;
  fileSize: number;
  deviceName?: string;
  deviceId?: string;
}

class FileService {
  private documentsPath: string;

  constructor() {
    this.documentsPath = RNFS.DocumentDirectoryPath;
    console.log('[FileService] Documents path:', this.documentsPath);
  }

  /**
   * Get list of all VTX recording files with metadata.
   * Reads only file headers (fast) — does not load full file contents.
   */
  async getRecordings(): Promise<RecordingMetadata[]> {
    try {
      const files = await RNFS.readDir(this.documentsPath);
      const recordingFiles = files
        .filter(file => file.name.endsWith('.vtx'))
        .sort((a, b) => b.mtime!.getTime() - a.mtime!.getTime()); // Newest first

      const recordings: RecordingMetadata[] = [];

      for (const file of recordingFiles) {
        // Parse filename to extract device name
        // Format: [deviceName_]imu_YYYY-MM-DD_HH-MM-SS.vtx
        const nameMatch = file.name.match(/^(?:(.+?)_)?imu_(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.vtx$/);
        let deviceName = nameMatch?.[1]?.replace(/_/g, ' ');

        let sampleCount = 0;
        let startTime: Date | undefined;
        let endTime: Date | undefined;

        try {
          // Read only VTX header + metadata (fast — reads ~200 bytes, not entire file)
          const { header, metadata } = await VTXFileService.readVTXMetadata(file.path);
          sampleCount = Number(header.recordCount);
          startTime = new Date(Number(header.startTimestamp));
          endTime = new Date(Number(header.endTimestamp));

          if (!deviceName && metadata?.device?.name) {
            deviceName = metadata.device.name;
          }
        } catch (err) {
          console.warn(`[FileService] Could not read VTX metadata: ${file.name}`, err);
        }

        recordings.push({
          fileName: file.name,
          filePath: file.path,
          startTime: startTime || file.mtime || new Date(file.ctime || Date.now()),
          endTime,
          sampleCount,
          fileSize: file.size,
          deviceName
        });
      }

      return recordings;
    } catch (error) {
      console.error('[FileService] Error reading recordings:', error);
      return [];
    }
  }

  /**
   * Get full path for a file
   */
  getFilePath(fileName: string): string {
    return `${this.documentsPath}/${fileName}`;
  }

  /**
   * Delete a recording file
   */
  async deleteRecording(fileName: string): Promise<void> {
    const filePath = this.getFilePath(fileName);

    try {
      await RNFS.unlink(filePath);
      console.log(`[FileService] Deleted recording: ${fileName}`);
    } catch (error) {
      console.error('[FileService] Error deleting recording:', error);
      throw error;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      return await RNFS.exists(filePath);
    } catch {
      return false;
    }
  }
}

export default new FileService();
